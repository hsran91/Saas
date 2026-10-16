const express = require("express");
const mongoose = require("mongoose");
const Stripe = require("stripe");
const Tenant = require("../models/Tenant");
const Resident = require("../models/Resident");
const Invoice = require("../models/Invoice");
const StripeWebhookEvent = require("../models/StripeWebhookEvent");
const auth = require("../middleware/auth");
const { runWriteTransaction } = require("../services/transactions");
const { logRequest, serializeError } = require("../utils/logger");

const router = express.Router();
let stripeClient;

function getStripeClient() {
  if (!process.env.STRIPE_SECRET_KEY) {
    const error = new Error("Stripe payments are not configured");
    error.status = 503;
    throw error;
  }
  if (!stripeClient) stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY);
  return stripeClient;
}

function getAppBaseUrl() {
  const value = process.env.APP_BASE_URL;
  if (!value) {
    const error = new Error("APP_BASE_URL is not configured");
    error.status = 503;
    throw error;
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    const error = new Error("APP_BASE_URL must be a valid HTTP(S) URL");
    error.status = 500;
    throw error;
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    const error = new Error("APP_BASE_URL must be a valid HTTP(S) URL");
    error.status = 500;
    throw error;
  }
  return parsed.toString().replace(/\/$/, "");
}

function toCents(value) {
  return Math.round(Number(value || 0) * 100);
}

function getPaidCents(invoice) {
  if (Number(invoice.amountPaid) > 0) return toCents(invoice.amountPaid);
  return invoice.status === "paid" ? toCents(invoice.amount) : 0;
}

function getInvoiceOutstandingCents(invoice) {
  return Math.max(0, toCents(invoice.amount) - getPaidCents(invoice));
}

async function createCheckoutSession(tenantId, residentId, tenant, invoices, invoiceId = null) {
  if (!tenant || !tenant.stripeAccountId) {
    const error = new Error("This merchant has not connected a Stripe account");
    error.status = 409;
    throw error;
  }
  if (!invoices.length) {
    const error = new Error("This resident has no outstanding balance");
    error.status = 400;
    throw error;
  }
  const balanceCents = invoices.reduce((sum, invoice) => sum + getInvoiceOutstandingCents(invoice), 0);
  if (!balanceCents) {
    const error = new Error("This resident has no outstanding balance");
    error.status = 400;
    throw error;
  }

  const stripe = getStripeClient();
  const account = await stripe.accounts.retrieve(tenant.stripeAccountId);
  if (!account.charges_enabled || !account.payouts_enabled) {
    const error = new Error("The merchant's Stripe account is not ready to accept payments");
    error.status = 409;
    throw error;
  }
  const baseUrl = getAppBaseUrl();
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    client_reference_id: String(residentId),
    line_items: [{
      price_data: {
        currency: "usd",
        product_data: {
          name: "Care services balance",
          description: `${invoices.length} outstanding invoice${invoices.length === 1 ? "" : "s"}`
        },
        unit_amount: balanceCents
      },
      quantity: 1
    }],
    metadata: {
      tenantId: String(tenantId),
      residentId: String(residentId),
      ...(invoiceId ? { invoiceId: String(invoiceId) } : {})
    },
    success_url: `${baseUrl}/index.html?stripe_payment=success`,
    cancel_url: `${baseUrl}/index.html?stripe_payment=cancelled`
  }, { stripeAccount: tenant.stripeAccountId });

  return session.url;
}

function isDuplicateKeyError(error) {
  return error && error.code === 11000;
}

router.get("/connect/status", auth.requireRole("admin"), async (req, res) => {
  try {
    const configured = Boolean(process.env.STRIPE_SECRET_KEY && process.env.APP_BASE_URL);
    const tenant = await Tenant.findById(req.tenantId).select("stripeAccountId").lean();
    if (!tenant) return res.status(404).json({ error: "Merchant account not found" });
    if (!tenant.stripeAccountId) return res.json({ connected: false, configured });

    const account = await getStripeClient().accounts.retrieve(tenant.stripeAccountId);
    res.json({
      connected: Boolean(account.charges_enabled && account.payouts_enabled),
      configured,
      detailsSubmitted: Boolean(account.details_submitted),
      chargesEnabled: Boolean(account.charges_enabled),
      payoutsEnabled: Boolean(account.payouts_enabled)
    });
  } catch (err) {
    logRequest("error", req, "Stripe Connect status lookup failed", { error: serializeError(err) });
    res.status(err.status || 502).json({ error: err.status === 503 ? err.message : "Unable to retrieve Stripe account status" });
  }
});

router.post("/connect/onboarding", auth.requireRole("admin"), async (req, res) => {
  try {
    const stripe = getStripeClient();
    const baseUrl = getAppBaseUrl();
    const tenant = await Tenant.findById(req.tenantId).select("name stripeAccountId");
    if (!tenant) return res.status(404).json({ error: "Merchant account not found" });

    let accountId = tenant.stripeAccountId;
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: "express",
        country: (process.env.STRIPE_CONNECT_DEFAULT_COUNTRY || "US").trim().toUpperCase(),
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true }
        },
        business_profile: {
          name: tenant.name,
          product_description: "Care services"
        }
      }, { idempotencyKey: `care-connect-${String(tenant._id)}` });
      accountId = account.id;
      tenant.stripeAccountId = accountId;
      await tenant.save();
    }

    const link = await stripe.accountLinks.create({
      account: accountId,
      type: "account_onboarding",
      return_url: `${baseUrl}/index.html?stripe_connect=complete`,
      refresh_url: `${baseUrl}/index.html?stripe_connect=refresh`
    });
    res.json({ url: link.url });
  } catch (err) {
    logRequest("error", req, "Stripe Connect onboarding link failed", { error: serializeError(err) });
    res.status(err.status || 502).json({ error: err.status === 503 ? err.message : "Unable to start Stripe onboarding" });
  }
});

router.post("/checkout/invoice/:invoiceId", auth.requireRole("admin", "poa"), async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.invoiceId)) {
      return res.status(400).json({ error: "invoiceId must be a valid id" });
    }
    const invoice = await Invoice.findOne({ _id: req.params.invoiceId, tenantId: req.tenantId });
    if (!invoice) return res.status(404).json({ error: "Invoice not found" });
    if (req.user.role === "poa" && String(req.user.residentId) !== String(invoice.residentId)) {
      return res.status(403).json({ error: "Access denied" });
    }
    const [tenant, resident] = await Promise.all([
      Tenant.findById(req.tenantId).select("stripeAccountId").lean(),
      Resident.findOne({ _id: invoice.residentId, tenantId: req.tenantId }).select("firstName lastName").lean()
    ]);
    if (!resident) return res.status(404).json({ error: "Resident not found" });
    const url = await createCheckoutSession(req.tenantId, invoice.residentId, tenant, [invoice], invoice._id);
    res.json({ url });
  } catch (err) {
    logRequest("error", req, "Stripe invoice Checkout creation failed", { error: serializeError(err) });
    res.status(err.status || 502).json({ error: err.status ? err.message : "Unable to start Stripe Checkout" });
  }
});

router.post("/checkout/resident/:residentId", auth.requireRole("admin", "poa"), async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.residentId)) {
      return res.status(400).json({ error: "residentId must be a valid id" });
    }
    if (req.user.role === "poa" && String(req.user.residentId) !== req.params.residentId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const [tenant, resident, invoices] = await Promise.all([
      Tenant.findById(req.tenantId).select("stripeAccountId").lean(),
      Resident.findOne({ _id: req.params.residentId, tenantId: req.tenantId }).select("firstName lastName").lean(),
      Invoice.find({
        tenantId: req.tenantId,
        residentId: req.params.residentId,
        status: "pending"
      }).sort({ dueDate: 1, createdAt: 1, _id: 1 })
    ]);
    if (!resident) return res.status(404).json({ error: "Resident not found" });
    const url = await createCheckoutSession(req.tenantId, req.params.residentId, tenant, invoices);
    res.json({ url });
  } catch (err) {
    logRequest("error", req, "Stripe Checkout session creation failed", { error: serializeError(err) });
    res.status(err.status || 502).json({ error: err.status === 503 ? err.message : "Unable to start Stripe Checkout" });
  }
});

async function handleWebhook(req, res) {
  const signature = req.headers["stripe-signature"];
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(503).json({ error: "Stripe webhook is not configured" });
  }

  let stripe;
  try {
    stripe = getStripeClient();
  } catch (err) {
    logRequest("error", req, "Stripe webhook is not configured", { error: serializeError(err) });
    return res.status(err.status || 503).json({ error: err.message });
  }
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).json({ error: "Invalid Stripe webhook signature" });
  }
  if (event.type !== "checkout.session.completed") return res.sendStatus(200);

  const session = event.data.object;
  if (session.payment_status !== "paid") return res.sendStatus(200);
  if (!Number.isSafeInteger(session.amount_total) || session.amount_total <= 0 || session.currency !== "usd") {
    logRequest("error", req, "Stripe Checkout event has an invalid amount or currency", { stripeEventId: event.id });
    return res.status(400).json({ error: "Stripe event has an invalid amount or currency" });
  }
  if (!event.account || !session.metadata?.tenantId || !session.metadata?.residentId || !session.payment_intent) {
    logRequest("error", req, "Stripe Checkout event is missing merchant or resident context", { stripeEventId: event.id });
    return res.status(400).json({ error: "Stripe event is missing payment context" });
  }

  let webhookEvent;
  try {
    webhookEvent = await StripeWebhookEvent.create({ eventId: event.id, status: "processing" });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      const existing = await StripeWebhookEvent.findOne({ eventId: event.id }).lean();
      if (existing?.status === "processed") return res.sendStatus(200);
      if (existing && Date.now() - new Date(existing.updatedAt).getTime() < 5 * 60 * 1000) {
        return res.status(500).json({ error: "Stripe payment event is already being processed" });
      }
      if (existing) await StripeWebhookEvent.deleteOne({ _id: existing._id, status: "processing" });
      try {
        webhookEvent = await StripeWebhookEvent.create({ eventId: event.id, status: "processing" });
      } catch (retryError) {
        if (isDuplicateKeyError(retryError)) return res.status(500).json({ error: "Stripe payment event is already being processed" });
        logRequest("error", req, "Stripe webhook event could not be recorded", { error: serializeError(retryError) });
        return res.status(500).json({ error: "Unable to record payment event" });
      }
    } else {
      logRequest("error", req, "Stripe webhook event could not be recorded", { error: serializeError(err) });
      return res.status(500).json({ error: "Unable to record payment event" });
    }
  }

  try {
    const tenantId = session.metadata.tenantId;
    const residentId = session.metadata.residentId;
    if (!mongoose.Types.ObjectId.isValid(tenantId) || !mongoose.Types.ObjectId.isValid(residentId)) {
      throw new Error("Stripe payment metadata contains invalid identifiers");
    }
    const tenant = await Tenant.findOne({ _id: tenantId, stripeAccountId: event.account }).select("_id").lean();
    if (!tenant) throw new Error("Stripe payment account does not match the merchant");

    const stripe = getStripeClient();
    const targetInvoiceId = session.metadata.invoiceId;
    if (targetInvoiceId && !mongoose.Types.ObjectId.isValid(targetInvoiceId)) {
      throw new Error("Stripe payment metadata contains an invalid invoice identifier");
    }
    await runWriteTransaction(async (transaction) => {
      let invoiceQuery = Invoice.find({
        tenantId,
        residentId,
        ...(targetInvoiceId ? { _id: targetInvoiceId } : {})
      }).sort({ dueDate: 1, createdAt: 1, _id: 1 });
      if (transaction) invoiceQuery = invoiceQuery.session(transaction);
      const invoices = await invoiceQuery;
      const paymentReference = `STRIPE-${session.id}`;
      const previouslyAllocatedCents = invoices.reduce((sum, invoice) => {
        return sum + invoice.paymentHistory
          .filter((payment) => payment.paymentReference === paymentReference)
          .reduce((paymentSum, payment) => paymentSum + toCents(payment.amount), 0);
      }, 0);
      const remainingChargeCents = Math.max(0, Number(session.amount_total) - previouslyAllocatedCents);
      const availableBalanceCents = invoices.reduce((sum, invoice) => sum + getInvoiceOutstandingCents(invoice), 0);
      const amountToAllocateCents = Math.min(remainingChargeCents, availableBalanceCents);
      const refundCents = remainingChargeCents - amountToAllocateCents;

      if (refundCents > 0) {
        await stripe.refunds.create({
          payment_intent: session.payment_intent,
          amount: refundCents
        }, {
          stripeAccount: event.account,
          idempotencyKey: `care-overpayment-${session.id}`
        });
      }

      let remainingCents = amountToAllocateCents;
      const paidAt = new Date(event.created * 1000);
      for (const invoice of invoices) {
        if (remainingCents <= 0) break;
        const allocatedCents = Math.min(remainingCents, getInvoiceOutstandingCents(invoice));
        if (!allocatedCents) continue;
        const paidCents = getPaidCents(invoice) + allocatedCents;
        invoice.amountPaid = paidCents / 100;
        invoice.status = paidCents >= toCents(invoice.amount) ? "paid" : "pending";
        invoice.paidAt = invoice.status === "paid" ? paidAt : undefined;
        invoice.paymentMethod = "credit";
        invoice.paymentReference = paymentReference;
        invoice.paymentHistory.push({
          amount: allocatedCents / 100,
          paymentMethod: "credit",
          paymentReference,
          paidAt
        });
        await invoice.save(transaction ? { session: transaction } : undefined);
        remainingCents -= allocatedCents;
      }
    });

    webhookEvent.status = "processed";
    await webhookEvent.save();
    return res.sendStatus(200);
  } catch (err) {
    await StripeWebhookEvent.deleteOne({ _id: webhookEvent._id });
    logRequest("error", req, "Stripe payment event processing failed", {
      stripeEventId: event.id,
      error: serializeError(err)
    });
    return res.status(500).json({ error: "Unable to reconcile Stripe payment" });
  }
}

module.exports = router;
module.exports.handleWebhook = handleWebhook;

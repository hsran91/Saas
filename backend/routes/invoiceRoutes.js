const express = require("express");
const mongoose = require("mongoose");
const crypto = require("crypto");
const router = express.Router();
const Invoice = require("../models/Invoice");
const Resident = require("../models/Resident");
const auth = require("../middleware/auth");
const { getPagination, setPaginationHeaders } = require("../utils/pagination");
const { logRequest, serializeError } = require("../utils/logger");
const { runWriteTransaction } = require("../services/transactions");

const ALLOWED_INVOICE_CREATE_FIELDS = new Set([
  "residentId",
  "description",
  "amount",
  "dueDate",
  "notes",
  "paymentMethod",
  "payerName",
  "paymentInfo"
]);

const ALLOWED_PAYMENT_METHODS = new Set(["credit", "debit", "bank"]);
const ALLOWED_BALANCE_PAYMENT_METHODS = new Set(["credit", "debit", "bank"]);
const ALLOWED_BALANCE_PAYMENT_FIELDS = new Set(["amount", "paymentMethod", "payerName", "lastFour"]);

function toCents(value) {
  return Math.round(Number(value || 0) * 100);
}

function getInvoicePaidCents(invoice) {
  if (Number(invoice.amountPaid) > 0) return toCents(invoice.amountPaid);
  return invoice.status === "paid" ? toCents(invoice.amount) : 0;
}

function validateBalancePaymentPayload(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Request body must be an object");
  }

  const unsupportedFields = Object.keys(body).filter((key) => !ALLOWED_BALANCE_PAYMENT_FIELDS.has(key));
  if (unsupportedFields.length) {
    throw new Error(`Unsupported field(s): ${unsupportedFields.join(", ")}`);
  }

  const amount = Number(body.amount);
  const paymentMethod = typeof body.paymentMethod === "string" ? body.paymentMethod.trim().toLowerCase() : "";
  const payerName = normalizeOptionalText(body.payerName, "payerName", 120) || "";
  const lastFour = typeof body.lastFour === "string" ? body.lastFour.trim() : "";

  if (!Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(toCents(amount)) || toCents(amount) <= 0 || Math.round(amount * 100) !== amount * 100) {
    throw new Error("amount must be greater than zero and have no more than two decimal places");
  }
  if (!ALLOWED_BALANCE_PAYMENT_METHODS.has(paymentMethod)) {
    throw new Error("paymentMethod must be credit, debit, or bank");
  }
  if (!payerName) {
    throw new Error("payerName is required");
  }
  if (!/^\d{4}$/.test(lastFour)) {
    throw new Error("lastFour must contain exactly four digits");
  }

  return { amountCents: toCents(amount), paymentMethod, payerName, lastFour };
}

function calculatePaymentAllocations(invoices, amountCents) {
  let remainingCents = amountCents;
  const allocations = [];

  for (const invoice of invoices) {
    if (remainingCents <= 0) break;
    const invoiceBalanceCents = Math.max(0, toCents(invoice.amount) - getInvoicePaidCents(invoice));
    if (!invoiceBalanceCents) continue;

    const allocatedCents = Math.min(remainingCents, invoiceBalanceCents);
    allocations.push({
      invoice,
      allocatedCents,
      newPaidCents: getInvoicePaidCents(invoice) + allocatedCents
    });
    remainingCents -= allocatedCents;
  }

  if (remainingCents > 0) {
    throw new Error("Payment amount cannot exceed the outstanding balance");
  }

  return allocations;
}

function normalizeOptionalText(value, fieldName, maxLength) {
  if (value == null) return undefined;
  if (typeof value !== "string") {
    throw new Error(`${fieldName} must be a string`);
  }

  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.length > maxLength) {
    throw new Error(`${fieldName} must be ${maxLength} characters or fewer`);
  }
  return trimmed;
}

function validateAndNormalizeInvoiceCreatePayload(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Request body must be an object");
  }

  const unsupportedFields = Object.keys(body).filter((key) => !ALLOWED_INVOICE_CREATE_FIELDS.has(key));
  if (unsupportedFields.length) {
    throw new Error(`Unsupported field(s): ${unsupportedFields.join(", ")}`);
  }

  const residentId = typeof body.residentId === "string" ? body.residentId.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const amount = Number(body.amount);
  const notes = normalizeOptionalText(body.notes, "notes", 2000) || "";
  const payerName = normalizeOptionalText(body.payerName, "payerName", 120) || "";
  const paymentInfo = normalizeOptionalText(body.paymentInfo, "paymentInfo", 200) || "";
  const rawPaymentMethod = normalizeOptionalText(body.paymentMethod, "paymentMethod", 20) || "";
  const paymentMethod = rawPaymentMethod ? rawPaymentMethod.toLowerCase() : null;

  if (!residentId || !description || !Number.isFinite(amount)) {
    throw new Error("residentId, description, and amount are required");
  }

  if (!mongoose.Types.ObjectId.isValid(residentId)) {
    throw new Error("residentId must be a valid id");
  }

  if (description.length > 200) {
    throw new Error("description must be 200 characters or fewer");
  }

  if (amount < 0) {
    throw new Error("amount must be zero or greater");
  }

  if (paymentMethod && !ALLOWED_PAYMENT_METHODS.has(paymentMethod)) {
    throw new Error(`paymentMethod must be one of: ${Array.from(ALLOWED_PAYMENT_METHODS).join(", ")}`);
  }

  const hasAnyPaymentField = Boolean(paymentMethod || payerName || paymentInfo);
  const hasAllPaymentFields = Boolean(paymentMethod && payerName && paymentInfo);
  if (hasAnyPaymentField && !hasAllPaymentFields) {
    throw new Error("paymentMethod, payerName, and paymentInfo are all required when recording payment");
  }

  let dueDate = null;
  if (Object.prototype.hasOwnProperty.call(body, "dueDate") && body.dueDate !== null && body.dueDate !== "") {
    const parsedDueDate = new Date(body.dueDate);
    if (Number.isNaN(parsedDueDate.getTime())) {
      throw new Error("dueDate must be a valid date");
    }
    dueDate = parsedDueDate;
  }

  return {
    residentId,
    description,
    amount,
    dueDate,
    notes,
    paymentMethod,
    payerName,
    paymentInfo,
    isPaidOnCreate: hasAllPaymentFields
  };
}

// Create a new invoice
router.post("/", auth.requireRole("admin", "poa"), async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const payload = validateAndNormalizeInvoiceCreatePayload(req.body);
    const {
      residentId,
      description,
      amount,
      dueDate,
      notes,
      paymentMethod,
      payerName,
      paymentInfo,
      isPaidOnCreate
    } = payload;

    const resident = await Resident.findOne({ _id: residentId, tenantId }).select("_id").lean();
    if (!resident) {
      return res.status(404).json({ error: "Resident not found" });
    }

    if (req.user.role === "poa" && String(req.user.residentId) !== String(residentId)) {
      return res.status(403).json({ error: "Access denied" });
    }

    const invoice = new Invoice({
      tenantId,
      residentId,
      description,
      amount,
      dueDate,
      notes,
      paymentMethod,
      payerName,
      paymentInfo,
      paymentReference: isPaidOnCreate ? `PAY-${Date.now()}` : "",
      status: isPaidOnCreate ? "paid" : "pending",
      paidAt: isPaidOnCreate ? new Date() : undefined,
    });

    await invoice.save();
    res.json(invoice);
  } catch (err) {
    logRequest("error", req, "Invoice create failed", { error: serializeError(err) });
    res.status(400).json({ error: err.message });
  }
});

router.post("/:residentId/payments", auth.requireRole("admin"), async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.residentId)) {
      return res.status(400).json({ error: "residentId must be a valid id" });
    }

    const payment = validateBalancePaymentPayload(req.body);
    const paymentDate = new Date();
    const paymentReference = `SIM-${paymentDate.getTime()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    const result = await runWriteTransaction(async (session) => {
      let invoiceQuery = Invoice.find({
        tenantId: req.tenantId,
        residentId: req.params.residentId,
        status: "pending"
      }).sort({ dueDate: 1, createdAt: 1, _id: 1 });
      if (session) invoiceQuery = invoiceQuery.session(session);
      const invoices = await invoiceQuery;
      const outstandingCents = invoices.reduce((sum, invoice) => {
        return sum + Math.max(0, toCents(invoice.amount) - getInvoicePaidCents(invoice));
      }, 0);

      if (!outstandingCents) {
        const error = new Error("This client has no outstanding balance");
        error.status = 400;
        throw error;
      }
      if (payment.amountCents > outstandingCents) {
        const error = new Error("Payment amount cannot exceed the outstanding balance");
        error.status = 400;
        throw error;
      }

      const allocations = [];
      for (const allocation of calculatePaymentAllocations(invoices, payment.amountCents)) {
        const { invoice, allocatedCents, newPaidCents } = allocation;
        const invoiceTotalCents = toCents(invoice.amount);
        invoice.amountPaid = newPaidCents / 100;
        invoice.status = newPaidCents >= invoiceTotalCents ? "paid" : "pending";
        invoice.paidAt = invoice.status === "paid" ? paymentDate : undefined;
        invoice.paymentMethod = payment.paymentMethod;
        invoice.payerName = payment.payerName;
        invoice.paymentReference = paymentReference;
        invoice.paymentHistory.push({
          amount: allocatedCents / 100,
          paymentMethod: payment.paymentMethod,
          payerName: payment.payerName,
          lastFour: payment.lastFour,
          paymentReference,
          paidAt: paymentDate
        });
        await invoice.save(session ? { session } : undefined);
        allocations.push({ invoiceId: String(invoice._id), amount: allocatedCents / 100 });
      }

      return {
        paymentReference,
        amount: payment.amountCents / 100,
        paymentMethod: payment.paymentMethod,
        lastFour: payment.lastFour,
        allocations,
        remainingBalance: (outstandingCents - payment.amountCents) / 100
      };
    });

    res.status(201).json(result);
  } catch (err) {
    const status = err.status || 400;
    logRequest("error", req, "Balance payment simulation failed", { error: serializeError(err) });
    res.status(status).json({ error: err.message });
  }
});

// Get all invoices
router.get("/", auth.requireRole("admin"), async (req, res) => {
  try {
    const pagination = getPagination(req.query, { defaultLimit: 50, maxLimit: 200 });
    const invoices = await Invoice.find({ tenantId: req.tenantId })
      .sort({ createdAt: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .populate({
        path: "residentId",
        select: "firstName lastName roomNumber",
      });
    setPaginationHeaders(res, pagination, invoices.length);
    res.json(invoices);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get invoices for a resident
router.get("/:residentId", auth.requireRole("admin", "poa"), auth.requirePoaResidentMatch("residentId"), async (req, res) => {
  try {
    const pagination = getPagination(req.query, { defaultLimit: 50, maxLimit: 200 });
    const invoices = await Invoice.find({ tenantId: req.tenantId, residentId: req.params.residentId })
      .sort({ createdAt: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .populate({ path: "residentId", select: "firstName lastName roomNumber" });
    setPaginationHeaders(res, pagination, invoices.length);
    res.json(invoices);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Mark invoice paid
router.patch("/:invoiceId/pay", auth.requireRole("admin", "poa"), async (req, res) => {
  try {
    if (req.body && typeof req.body === "object" && Object.keys(req.body).length > 0) {
      return res.status(400).json({ error: "This endpoint does not accept a request body" });
    }

    if (!mongoose.Types.ObjectId.isValid(req.params.invoiceId)) {
      return res.status(400).json({ error: "invoiceId must be a valid id" });
    }

    const invoice = await Invoice.findOne({ _id: req.params.invoiceId, tenantId: req.tenantId });
    if (!invoice) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    if (req.user.role === "poa" && String(req.user.residentId) !== String(invoice.residentId)) {
      return res.status(403).json({ error: "Access denied" });
    }

    const paidCents = getInvoicePaidCents(invoice);
    const amountCents = toCents(invoice.amount);
    const paidAt = new Date();
    const paymentReference = `MANUAL-${Date.now()}`;
    if (amountCents > paidCents) {
      invoice.paymentHistory.push({
        amount: (amountCents - paidCents) / 100,
        paymentMethod: "manual",
        payerName: req.user.name || "",
        paymentReference,
        paidAt
      });
    }
    invoice.amountPaid = invoice.amount;
    invoice.status = "paid";
    invoice.paymentMethod = "manual";
    invoice.payerName = req.user.name || "";
    invoice.paymentReference = paymentReference;
    invoice.paidAt = paidAt;
    await invoice.save();

    res.json(invoice);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
module.exports._test = {
  validateAndNormalizeInvoiceCreatePayload,
  validateBalancePaymentPayload,
  calculatePaymentAllocations
};

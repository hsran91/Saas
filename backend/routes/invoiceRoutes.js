const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const Invoice = require("../models/Invoice");
const Resident = require("../models/Resident");
const auth = require("../middleware/auth");

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

    const resident = await Resident.findById(residentId).select("_id").lean();
    if (!resident) {
      return res.status(404).json({ error: "Resident not found" });
    }

    if (req.user.role === "poa" && String(req.user.residentId) !== String(residentId)) {
      return res.status(403).json({ error: "Access denied" });
    }

    const invoice = new Invoice({
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
    console.error("Error creating invoice:", err);
    res.status(400).json({ error: err.message });
  }
});

// Get all invoices
router.get("/", auth.requireRole("admin"), async (req, res) => {
  try {
    const invoices = await Invoice.find().sort({ createdAt: -1 }).populate({
      path: "residentId",
      select: "firstName lastName roomNumber",
    });
    res.json(invoices);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get invoices for a resident
router.get("/:residentId", auth.requireRole("admin", "poa"), auth.requirePoaResidentMatch("residentId"), async (req, res) => {
  try {
    const invoices = await Invoice.find({ residentId: req.params.residentId })
      .sort({ createdAt: -1 })
      .populate({ path: "residentId", select: "firstName lastName roomNumber" });
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

    const invoice = await Invoice.findById(req.params.invoiceId);
    if (!invoice) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    if (req.user.role === "poa" && String(req.user.residentId) !== String(invoice.residentId)) {
      return res.status(403).json({ error: "Access denied" });
    }

    invoice.status = "paid";
    invoice.paidAt = new Date();
    await invoice.save();

    res.json(invoice);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
module.exports._test = {
  validateAndNormalizeInvoiceCreatePayload
};

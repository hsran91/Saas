const express = require("express");
const router = express.Router();
const Invoice = require("../models/Invoice");
const auth = require("../middleware/auth");

// Create a new invoice
router.post("/", auth.requireRole("admin", "poa"), async (req, res) => {
  try {
    const {
      residentId,
      description,
      amount,
      dueDate,
      notes,
      paymentMethod,
      payerName,
      paymentInfo,
    } = req.body;

    if (!residentId || !description || amount === undefined) {
      return res.status(400).json({ error: "residentId, description, and amount are required" });
    }

    if (req.user.role === "poa" && String(req.user.residentId) !== String(residentId)) {
      return res.status(403).json({ error: "Access denied" });
    }

    const isPaid = paymentMethod && payerName && paymentInfo;

    const invoice = new Invoice({
      residentId,
      description,
      amount,
      dueDate: dueDate || null,
      notes: notes || "",
      paymentMethod: paymentMethod || null,
      payerName: payerName || "",
      paymentInfo: paymentInfo || "",
      paymentReference: isPaid ? `PAY-${Date.now()}` : "",
      status: isPaid ? "paid" : "pending",
      paidAt: isPaid ? new Date() : undefined,
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
router.get("/:residentId", auth.requireRole("admin", "poa"), async (req, res) => {
  try {
    if (req.user.role === "poa" && String(req.user.residentId) !== String(req.params.residentId)) {
      return res.status(403).json({ error: "Access denied" });
    }

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

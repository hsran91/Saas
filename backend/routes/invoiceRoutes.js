const express = require("express");
const router = express.Router();
const Invoice = require("../models/Invoice");

// Create a new invoice
router.post("/", async (req, res) => {
  try {
    const { residentId, description, amount, dueDate, notes } = req.body;

    if (!residentId || !description || amount === undefined) {
      return res.status(400).json({ error: "residentId, description, and amount are required" });
    }

    const invoice = new Invoice({
      residentId,
      description,
      amount,
      dueDate: dueDate || null,
      notes: notes || "",
    });

    await invoice.save();
    res.json(invoice);
  } catch (err) {
    console.error("Error creating invoice:", err);
    res.status(400).json({ error: err.message });
  }
});

// Get all invoices
router.get("/", async (req, res) => {
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
router.get("/:residentId", async (req, res) => {
  try {
    const invoices = await Invoice.find({ residentId: req.params.residentId }).sort({ createdAt: -1 });
    res.json(invoices);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Mark invoice paid
router.patch("/:invoiceId/pay", async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.invoiceId);
    if (!invoice) {
      return res.status(404).json({ error: "Invoice not found" });
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

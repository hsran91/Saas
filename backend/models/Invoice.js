const mongoose = require("mongoose");

const InvoiceSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Tenant",
    required: true,
    index: true,
  },
  residentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Resident",
    required: true,
  },
  description: {
    type: String,
    required: true,
  },
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
  dueDate: {
    type: Date,
  },
  notes: {
    type: String,
    default: "",
  },
  paymentMethod: {
    type: String,
    enum: ["credit", "debit", "bank"],
    default: null,
  },
  payerName: {
    type: String,
    default: "",
  },
  paymentInfo: {
    type: String,
    default: "",
  },
  paymentReference: {
    type: String,
    default: "",
  },
  status: {
    type: String,
    enum: ["pending", "paid"],
    default: "pending",
  },
  paidAt: {
    type: Date,
  },
}, { timestamps: true });

InvoiceSchema.index({ tenantId: 1, createdAt: -1 });
InvoiceSchema.index({ tenantId: 1, residentId: 1, createdAt: -1 });
InvoiceSchema.index({ tenantId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("Invoice", InvoiceSchema);

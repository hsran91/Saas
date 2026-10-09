const mongoose = require("mongoose");

const PaymentHistorySchema = new mongoose.Schema({
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
  paymentMethod: {
    type: String,
    enum: ["credit", "debit", "bank", "manual"],
    default: "manual",
  },
  payerName: {
    type: String,
    default: "",
  },
  lastFour: {
    type: String,
    default: "",
  },
  paymentReference: {
    type: String,
    default: "",
  },
  paidAt: {
    type: Date,
    default: Date.now,
  },
}, { _id: false });

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
  amountPaid: {
    type: Number,
    min: 0,
    default: 0,
  },
  paymentHistory: {
    type: [PaymentHistorySchema],
    default: [],
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

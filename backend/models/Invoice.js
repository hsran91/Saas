const mongoose = require("mongoose");

const InvoiceSchema = new mongoose.Schema({
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
  status: {
    type: String,
    enum: ["pending", "paid"],
    default: "pending",
  },
  paidAt: {
    type: Date,
  },
}, { timestamps: true });

module.exports = mongoose.model("Invoice", InvoiceSchema);

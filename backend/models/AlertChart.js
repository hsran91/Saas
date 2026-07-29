const mongoose = require("mongoose");

const AlertChartSchema = new mongoose.Schema({
  residentId: { type: mongoose.Schema.Types.ObjectId, ref: "Resident", required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: false },
  userName: { type: String, required: false },
  type: { type: String, required: true },
  notes: { type: String },
  alertTime: { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = mongoose.model("AlertChart", AlertChartSchema);

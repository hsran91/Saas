const mongoose = require("mongoose");

const AlertChartSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  residentId: { type: mongoose.Schema.Types.ObjectId, ref: "Resident", required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: false },
  userName: { type: String, required: false },
  type: { type: String, required: true },
  notes: { type: String },
  alertTime: { type: Date, default: Date.now },
}, { timestamps: true });

AlertChartSchema.index({ tenantId: 1, residentId: 1, createdAt: -1 });
AlertChartSchema.index({ tenantId: 1, createdAt: -1 });

module.exports = mongoose.model("AlertChart", AlertChartSchema);

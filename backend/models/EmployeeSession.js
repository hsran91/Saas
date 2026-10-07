const mongoose = require("mongoose");

const EmployeeSessionSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Tenant",
    required: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true
  },
  loginAt: { type: Date, required: true, default: Date.now },
  logoutAt: { type: Date, default: null }
}, { timestamps: true });

EmployeeSessionSchema.index({ tenantId: 1, userId: 1, loginAt: -1 });
EmployeeSessionSchema.index({ loginAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

module.exports = mongoose.model("EmployeeSession", EmployeeSessionSchema);

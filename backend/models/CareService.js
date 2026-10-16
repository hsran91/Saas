const mongoose = require("mongoose");

const CareServiceSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Tenant",
    required: true,
    index: true
  },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, default: "", trim: true, maxlength: 500 },
  amount: { type: Number, required: true, min: 0.01 },
  active: { type: Boolean, default: true }
}, { timestamps: true });

CareServiceSchema.index({ tenantId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model("CareService", CareServiceSchema);

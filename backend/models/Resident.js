const mongoose = require("mongoose");

const ResidentSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Tenant",
    required: true,
    index: true
  },
  firstName: { type: String, required: true },
  lastName: { type: String, default: "" },
  roomNumber: { type: String },
  residentCode: { type: String },
  photoUrl: { type: String, default: null },
  dob: { type: Date },
  allergies: { type: String },
  notes: { type: String },
}, { timestamps: true });

ResidentSchema.index({ tenantId: 1, residentCode: 1 }, { unique: true, sparse: true });
ResidentSchema.index({ tenantId: 1, createdAt: -1 });
ResidentSchema.index({ tenantId: 1, roomNumber: 1, firstName: 1 });

module.exports = mongoose.model("Resident", ResidentSchema);

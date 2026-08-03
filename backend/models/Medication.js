const mongoose = require('mongoose');

const MedicationSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true,
    index: true
  },
  name: { type: String, required: true },
  dosage: { type: String },
  route: { type: String },
  frequency: { type: String },
  time: { type: String },
  times: [{ type: String }],
  instructions: { type: String },
  residentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Resident', required: true },
  status: { type: String, default: 'active' },
  startDate: { type: Date, default: Date.now },
  endDate: { type: Date }
}, { timestamps: true });

MedicationSchema.index({ tenantId: 1, createdAt: -1 });
MedicationSchema.index({ tenantId: 1, residentId: 1, createdAt: -1 });
MedicationSchema.index({ tenantId: 1, residentId: 1, name: 1 });

module.exports = mongoose.model('Medication', MedicationSchema);

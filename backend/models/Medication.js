const mongoose = require('mongoose');

const MedicationSchema = new mongoose.Schema({
  name: { type: String, required: true },
  dosage: { type: String },
  route: { type: String },
  frequency: { type: String },
  time: { type: String },
  instructions: { type: String },
  residentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Resident', required: true },
  status: { type: String, default: 'active' },
  startDate: { type: Date, default: Date.now },
  endDate: { type: Date }
}, { timestamps: true });

module.exports = mongoose.model('Medication', MedicationSchema);

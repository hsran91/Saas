const mongoose = require("mongoose");

const ResidentSchema = new mongoose.Schema({
  firstName: { type: String, required: true },
  lastName: { type: String, default: "" },
  roomNumber: { type: String },
  dob: { type: Date },
  allergies: { type: String },
  notes: { type: String },
}, { timestamps: true });

module.exports = mongoose.model("Resident", ResidentSchema);

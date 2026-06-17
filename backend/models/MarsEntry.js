// models/MarEntry.js
const mongoose = require("mongoose");

const MarEntrySchema = new mongoose.Schema({
  residentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Resident",
    required: true
  },

  medicationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Medication",
    required: true
  },

  // "given", "held", "prn", "prn-followup", "refused"
  status: {
    type: String,
    enum: ["given", "held", "prn", "prn-followup", "refused"],
    required: true
  },

  // Scheduled time slot (Option B)
  scheduledTime: {
    type: String, // "08:00", "20:00", "PRN"
    required: true
  },

  // Actual timestamp of the action
  actualTime: {
    type: Date,
    default: Date.now
  },

  // Staff identity (from JWT)
  staffId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },

  staffName: {
    type: String,
    required: true
  },

  // Notes for PRN follow-up or general notes
  notes: {
    type: String
  },

  // Reason for PRN or Hold
  reason: {
    type: String
  }

}, { timestamps: true });

module.exports = mongoose.model("MarEntry", MarEntrySchema);

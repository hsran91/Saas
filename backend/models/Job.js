const mongoose = require("mongoose");

const JobSchema = new mongoose.Schema({
  type: {
    type: String,
    required: true
  },
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Tenant"
  },
  correlationId: {
    type: String,
    default: null
  },
  payload: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  status: {
    type: String,
    enum: ["pending", "running", "completed", "failed"],
    default: "pending"
  },
  attempts: {
    type: Number,
    default: 0
  },
  maxAttempts: {
    type: Number,
    default: 5
  },
  availableAt: {
    type: Date,
    default: Date.now
  },
  lockedAt: {
    type: Date,
    default: null
  },
  finishedAt: {
    type: Date,
    default: null
  },
  lastError: {
    type: String,
    default: ""
  }
}, { timestamps: true });

JobSchema.index({ status: 1, availableAt: 1, createdAt: 1 });
JobSchema.index({ tenantId: 1, createdAt: -1 });
JobSchema.index({ type: 1, status: 1, availableAt: 1 });

module.exports = mongoose.model("Job", JobSchema);
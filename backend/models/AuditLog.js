const mongoose = require("mongoose");

const AuditLogSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Tenant",
    required: true,
    immutable: true
  },
  entityType: {
    type: String,
    required: true,
    immutable: true
  },
  entityId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    immutable: true
  },
  residentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Resident",
    immutable: true
  },
  medicationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Medication",
    immutable: true
  },
  action: {
    type: String,
    required: true,
    immutable: true
  },
  actorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    immutable: true
  },
  actorName: {
    type: String,
    immutable: true
  },
  actorRole: {
    type: String,
    immutable: true
  },
  correlationId: {
    type: String,
    immutable: true
  },
  details: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
    immutable: true
  },
  eventTime: {
    type: Date,
    default: Date.now,
    immutable: true
  }
}, { timestamps: true });

function blockAuditLogMutation(next) {
  next(new Error("Audit logs are immutable"));
}

AuditLogSchema.pre("findOneAndUpdate", blockAuditLogMutation);
AuditLogSchema.pre("updateOne", blockAuditLogMutation);
AuditLogSchema.pre("deleteOne", blockAuditLogMutation);
AuditLogSchema.pre("findOneAndDelete", blockAuditLogMutation);
AuditLogSchema.index({ tenantId: 1, residentId: 1, createdAt: -1 });
AuditLogSchema.index({ tenantId: 1, medicationId: 1, createdAt: -1 });
AuditLogSchema.index({ tenantId: 1, action: 1, createdAt: -1 });

module.exports = mongoose.model("AuditLog", AuditLogSchema);
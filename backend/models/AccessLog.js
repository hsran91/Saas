const mongoose = require("mongoose");

const ACCESS_LOG_RETENTION_DAYS = Number(process.env.ACCESS_LOG_RETENTION_DAYS || 365);

function buildExpiryDate() {
  return new Date(Date.now() + ACCESS_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

const AccessLogSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Tenant",
    required: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  userRole: {
    type: String,
    required: true
  },
  method: {
    type: String,
    required: true
  },
  path: {
    type: String,
    required: true
  },
  resourceType: {
    type: String,
    default: "unknown"
  },
  statusCode: {
    type: Number,
    required: true
  },
  ipAddress: {
    type: String,
    default: null
  },
  correlationId: {
    type: String,
    default: null
  },
  expiresAt: {
    type: Date,
    default: buildExpiryDate,
    index: { expireAfterSeconds: 0 }
  }
}, { timestamps: true });

AccessLogSchema.index({ tenantId: 1, createdAt: -1 });
AccessLogSchema.index({ tenantId: 1, userId: 1, createdAt: -1 });
AccessLogSchema.index({ tenantId: 1, resourceType: 1, createdAt: -1 });

module.exports = mongoose.model("AccessLog", AccessLogSchema);
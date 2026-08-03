const AuditLog = require("../models/AuditLog");

async function recordAuditEvent({
  req,
  tenantId,
  action,
  entityType,
  entityId,
  residentId,
  medicationId,
  details,
  session
}) {
  const auditLog = new AuditLog({
    tenantId,
    action,
    entityType,
    entityId,
    residentId,
    medicationId,
    actorId: req?.user?.id,
    actorName: req?.user?.name,
    actorRole: req?.user?.role,
    correlationId: req?.correlationId,
    details: details || {}
  });

  return auditLog.save(session ? { session } : undefined);
}

module.exports = {
  recordAuditEvent
};
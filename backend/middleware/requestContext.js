const { randomUUID } = require("crypto");
const { enqueueJob } = require("../services/jobQueue");
const { recordHttpRequest } = require("../services/metrics");
const { logRequest } = require("../utils/logger");

const PROTECTED_ROUTE_ROOTS = new Set([
  "residents",
  "medications",
  "mar",
  "invoices",
  "alerts",
  "dashboard"
]);

function getRouteRoot(req) {
  return (req.originalUrl || "")
    .split("?")[0]
    .split("/")
    .filter(Boolean)[0] || "";
}

function shouldQueueAccessLog(req) {
  return Boolean(req.user && req.tenantId && PROTECTED_ROUTE_ROOTS.has(getRouteRoot(req)));
}

function requestContext(req, res, next) {
  const incomingCorrelationId = typeof req.headers["x-correlation-id"] === "string"
    ? req.headers["x-correlation-id"].trim()
    : "";

  req.correlationId = incomingCorrelationId || randomUUID();
  res.setHeader("x-correlation-id", req.correlationId);
  next();
}

function requestLifecycle(req, res, next) {
  const startedAt = process.hrtime.bigint();

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    recordHttpRequest(req, res, durationMs);

    logRequest(res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info", req, "Request completed", {
      statusCode: res.statusCode,
      durationMs: Number(durationMs.toFixed(2))
    });

    if (!shouldQueueAccessLog(req)) {
      return;
    }

    void enqueueJob({
      type: "access-log.write",
      tenantId: req.tenantId,
      correlationId: req.correlationId,
      payload: {
        tenantId: req.tenantId,
        userId: req.user.id,
        userRole: req.user.role,
        method: req.method,
        path: (req.originalUrl || "").split("?")[0],
        statusCode: res.statusCode,
        ipAddress: req.ip,
        correlationId: req.correlationId,
        resourceType: getRouteRoot(req)
      }
    }).catch((err) => {
      logRequest("error", req, "Failed to enqueue access log", {
        error: err.message
      });
    });
  });

  next();
}

module.exports = {
  requestContext,
  requestLifecycle
};
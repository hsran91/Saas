const client = require("prom-client");

const register = new client.Registry();
client.collectDefaultMetrics({ register, prefix: "emar_" });

const httpRequestsTotal = new client.Counter({
  name: "emar_http_requests_total",
  help: "Total HTTP requests handled by the API.",
  labelNames: ["method", "route", "status_code"],
  registers: [register]
});

const httpRequestErrorsTotal = new client.Counter({
  name: "emar_http_request_errors_total",
  help: "HTTP requests that completed with client or server errors.",
  labelNames: ["method", "route", "status_code"],
  registers: [register]
});

const httpRequestDurationMs = new client.Histogram({
  name: "emar_http_request_duration_ms",
  help: "HTTP request latency in milliseconds.",
  labelNames: ["method", "route", "status_code"],
  buckets: [25, 50, 100, 250, 500, 1000, 2500, 5000],
  registers: [register]
});

const loginFailuresTotal = new client.Counter({
  name: "emar_login_failures_total",
  help: "Failed login attempts.",
  labelNames: ["reason", "tenant_id"],
  registers: [register]
});

const marWriteFailuresTotal = new client.Counter({
  name: "emar_mar_write_failures_total",
  help: "Failed MAR write attempts.",
  labelNames: ["reason", "tenant_id"],
  registers: [register]
});

function getRouteLabel(req) {
  if (req.baseUrl && req.route?.path) {
    return `${req.baseUrl}${req.route.path}`;
  }

  return req.originalUrl?.split("?")[0] || req.path || "unknown";
}

function recordHttpRequest(req, res, durationMs) {
  const labels = {
    method: req.method,
    route: getRouteLabel(req),
    status_code: String(res.statusCode)
  };

  httpRequestsTotal.inc(labels);
  httpRequestDurationMs.observe(labels, durationMs);

  if (res.statusCode >= 400) {
    httpRequestErrorsTotal.inc(labels);
  }
}

function incrementLoginFailure(reason, tenantId = "unknown") {
  loginFailuresTotal.inc({ reason, tenant_id: tenantId || "unknown" });
}

function incrementMarWriteFailure(reason, tenantId = "unknown") {
  marWriteFailuresTotal.inc({ reason, tenant_id: tenantId || "unknown" });
}

function metricsAccessGuard(req, res, next) {
  const expectedToken = process.env.METRICS_TOKEN;

  if (!expectedToken) {
    if (process.env.NODE_ENV === "production") {
      return res.status(404).json({ error: "Not found" });
    }
    return next();
  }

  if (req.headers["x-metrics-token"] !== expectedToken) {
    return res.status(403).json({ error: "Forbidden" });
  }

  return next();
}

async function getMetrics() {
  return register.metrics();
}

module.exports = {
  recordHttpRequest,
  incrementLoginFailure,
  incrementMarWriteFailure,
  getMetrics,
  metricsContentType: register.contentType,
  metricsAccessGuard
};
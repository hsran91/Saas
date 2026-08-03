function serializeError(err) {
  if (!err) return null;

  return {
    name: err.name,
    message: err.message,
    code: err.code,
    stack: process.env.NODE_ENV === "production" ? undefined : err.stack
  };
}

function emit(level, message, context = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...context
  };

  const sink = level === "error"
    ? console.error
    : level === "warn"
      ? console.warn
      : console.log;

  sink(JSON.stringify(entry));
}

function getRequestContext(req) {
  return {
    correlationId: req?.correlationId,
    tenantId: req?.tenantId || null,
    userId: req?.user?.id || null,
    userRole: req?.user?.role || null,
    method: req?.method,
    path: req?.originalUrl
  };
}

function logRequest(level, req, message, context = {}) {
  emit(level, message, {
    ...getRequestContext(req),
    ...context
  });
}

function logInfo(message, context = {}) {
  emit("info", message, context);
}

function logWarn(message, context = {}) {
  emit("warn", message, context);
}

function logError(message, context = {}) {
  emit("error", message, context);
}

module.exports = {
  logInfo,
  logWarn,
  logError,
  logRequest,
  serializeError
};
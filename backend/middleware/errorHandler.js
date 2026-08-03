const { logRequest, serializeError } = require("../utils/logger");

function notFoundHandler(req, res, next) {
  const err = new Error(`Route not found: ${req.method} ${req.originalUrl}`);
  err.status = 404;
  next(err);
}

function getErrorStatus(err) {
  if (typeof err?.status === "number") return err.status;
  if (typeof err?.statusCode === "number") return err.statusCode;

  if (err?.type === "entity.parse.failed") return 400;
  if (err?.name === "ValidationError") return 400;
  if (err?.name === "CastError") return 400;
  if (err?.name === "JsonWebTokenError") return 401;
  if (err?.name === "TokenExpiredError") return 401;
  if (err?.name === "MongoServerError" && err?.code === 11000) return 409;
  if (err?.message === "CORS origin not allowed") return 403;

  return 500;
}

function getErrorMessage(err, status) {
  if (err?.name === "CastError") {
    return `Invalid value for ${err.path}`;
  }

  if (err?.name === "MongoServerError" && err?.code === 11000) {
    return "Duplicate value violates a unique constraint";
  }

  if (status >= 500) {
    return "Internal server error";
  }

  return err?.message || "Request failed";
}

function errorHandler(err, req, res, next) {
  const status = getErrorStatus(err);
  const payload = {
    error: getErrorMessage(err, status),
    correlationId: req?.correlationId
  };

  if (process.env.NODE_ENV !== "production") {
    payload.details = {
      name: err?.name,
      message: err?.message,
      code: err?.code
    };
  }

  if (status >= 500) {
    logRequest("error", req, "Unhandled server error", {
      status,
      error: serializeError(err)
    });
  }

  res.status(status).json(payload);
}

module.exports = {
  notFoundHandler,
  errorHandler
};

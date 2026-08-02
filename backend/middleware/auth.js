const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_ISSUER = process.env.JWT_ISSUER;
const JWT_AUDIENCE = process.env.JWT_AUDIENCE;

if (!JWT_SECRET) {
  throw new Error("Missing required environment variable: JWT_SECRET");
}
if (!JWT_ISSUER) {
  throw new Error("Missing required environment variable: JWT_ISSUER");
}
if (!JWT_AUDIENCE) {
  throw new Error("Missing required environment variable: JWT_AUDIENCE");
}

function normalizeTenantId(tenantId) {
  if (!tenantId) return null;
  if (typeof tenantId === "string") {
    if (!mongoose.Types.ObjectId.isValid(tenantId)) return null;
    return tenantId;
  }
  return String(tenantId);
}

function auth(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) return res.status(401).json({ error: "No token provided" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE
    });

    const tenantId = normalizeTenantId(decoded.tenantId);
    if (!tenantId) {
      return res.status(401).json({ error: "Invalid token: missing tenant context" });
    }

    const headerTenant = normalizeTenantId(req.headers["x-tenant-id"]);
    if (headerTenant && headerTenant !== tenantId) {
      return res.status(403).json({ error: "Cross-tenant access denied" });
    }

    req.user = decoded;
    req.user.tenantId = tenantId;
    req.tenantId = tenantId;
    next();
  } catch (err) {
    res.status(401).json({ error: "Invalid token" });
  }
}

auth.requireRole = function (...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Authentication required" });
    if (roles.includes(req.user.role)) return next();
    return res.status(403).json({ error: "Access denied" });
  };
};

auth.requirePoaResidentMatch = function (paramName = "residentId") {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Authentication required" });
    if (req.user.role === "admin") return next();
    if (req.user.role === "poa") {
      if (!req.user.residentId || String(req.user.residentId) !== String(req.params[paramName])) {
        return res.status(403).json({ error: "Access denied" });
      }
      return next();
    }
    return res.status(403).json({ error: "Access denied" });
  };
};

auth.JWT_SECRET = JWT_SECRET;
auth.JWT_ISSUER = JWT_ISSUER;
auth.JWT_AUDIENCE = JWT_AUDIENCE;

module.exports = auth;

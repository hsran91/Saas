const jwt = require("jsonwebtoken");
const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";

function auth(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) return res.status(401).json({ error: "No token provided" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
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

module.exports = auth;

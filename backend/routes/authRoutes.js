const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const rateLimit = require("express-rate-limit");
const auth = require("../middleware/auth");
const User = require("../models/User");
const Resident = require("../models/Resident");
const EmployeeSession = require("../models/EmployeeSession");
const { incrementLoginFailure } = require("../services/metrics");
const { sendUserProvisionedEmail } = require("../services/email");
const { logRequest } = require("../utils/logger");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_ISSUER = process.env.JWT_ISSUER;
const JWT_AUDIENCE = process.env.JWT_AUDIENCE;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

if (!JWT_SECRET) {
  throw new Error("Missing required environment variable: JWT_SECRET");
}
if (!JWT_ISSUER) {
  throw new Error("Missing required environment variable: JWT_ISSUER");
}
if (!JWT_AUDIENCE) {
  throw new Error("Missing required environment variable: JWT_AUDIENCE");
}

const LOGIN_RATE_LIMIT_WINDOW_MS = Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS || 10 * 60 * 1000);
const LOGIN_RATE_LIMIT_MAX = Number(process.env.LOGIN_RATE_LIMIT_MAX || 10);
const AUTH_FAILURE_MESSAGE = "Invalid credentials";
// Constant bcrypt hash used when user is not found to reduce timing differences.
const DUMMY_PASSWORD_HASH = "$2a$10$MPCm4YfB4BvDl3j5Qk1Vce8ubtL6fMVS03/0Ab8f2kn6FQJ7s6v8S";

const loginLimiter = rateLimit({
  windowMs: LOGIN_RATE_LIMIT_WINDOW_MS,
  max: LOGIN_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please try again later." },
  skipSuccessfulRequests: true
});

// REGISTER STAFF
router.post("/register", auth, auth.requireRole("admin"), async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const { name, username, email, password, role, residentCode } = req.body;

    if (!name || !username || !email || !password || !role) {
      return res.status(400).json({ error: "Name, username, email, password, and role are required" });
    }

    if (role === "poa" && !residentCode) {
      return res.status(400).json({ error: "POA users must be linked to a resident code" });
    }

    const isValidUsername = (role, username) => {
      if (role === "admin") return username.startsWith("adm");
      if (role === "medtech" || role === "rn") return username.startsWith("med");
      if (role === "poa") return username.startsWith("res");
      return true;
    };

    if (!isValidUsername(role, username)) {
      return res.status(400).json({ error: "Username prefix does not match selected role" });
    }

    const usernameExists = await User.findOne({ tenantId, username });
    if (usernameExists) return res.status(400).json({ error: "Username already in use" });

    const emailExists = await User.findOne({ tenantId, email });
    if (emailExists) return res.status(400).json({ error: "Email already in use" });

    const hashed = await bcrypt.hash(password, 10);
    let poaResidentId;

    if (role === "poa") {
      const resident = await Resident.findOne({ tenantId, residentCode });
      if (!resident) {
        return res.status(400).json({ error: "Resident code not found" });
      }
      poaResidentId = resident._id;
    }

    const user = await User.create({
      tenantId,
      name,
      username,
      email,
      password: hashed,
      role,
      residentId: role === "poa" ? poaResidentId : undefined,
    });

    void sendUserProvisionedEmail({
      to: user.email,
      name: user.name,
      username: user.username,
      role: user.role,
      tenantId: String(user.tenantId),
      issuedBy: req.user?.name || req.user?.id || "administrator"
    });

    res.json({ message: "User registered", user: { id: user._id, name: user.name, username: user.username, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// LOGIN STAFF
router.post("/login", loginLimiter, async (req, res) => {
  try {
    const { username, email, password, tenantId } = req.body;
    const loginKey = username || email;
    const rawTenantId = typeof tenantId === "string"
      ? tenantId.trim()
      : (typeof req.headers["x-tenant-id"] === "string" ? req.headers["x-tenant-id"].trim() : "");
    const normalizedTenantId = rawTenantId || "";

    if (!loginKey || !password) {
      incrementLoginFailure("missing_credentials", normalizedTenantId || undefined);
      return res.status(400).json({ error: "Username and password are required" });
    }

    if (normalizedTenantId && !mongoose.Types.ObjectId.isValid(normalizedTenantId)) {
      incrementLoginFailure("invalid_tenant", normalizedTenantId || undefined);
      return res.status(400).json({ error: "tenantId must be a valid id" });
    }

    let user = null;
    if (username) {
      user = await User.findOne({ username, ...(normalizedTenantId ? { tenantId: normalizedTenantId } : {}) });
      if (!user && username.includes("@")) {
        user = await User.findOne({ email: username, ...(normalizedTenantId ? { tenantId: normalizedTenantId } : {}) });
      }
    } else {
      user = await User.findOne({ email: loginKey, ...(normalizedTenantId ? { tenantId: normalizedTenantId } : {}) });
    }

    if (!user && !normalizedTenantId) {
      const duplicates = username
        ? await User.countDocuments({ username })
        : await User.countDocuments({ email: loginKey });
      if (duplicates > 1) {
        await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
        incrementLoginFailure("missing_tenant_context");
        return res.status(400).json({ error: "Tenant ID is required for this account" });
      }
    }

    if (!user) {
      await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
      incrementLoginFailure("user_not_found", normalizedTenantId || undefined);
      return res.status(401).json({ error: AUTH_FAILURE_MESSAGE });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      incrementLoginFailure("password_mismatch", String(user.tenantId));
      return res.status(401).json({ error: AUTH_FAILURE_MESSAGE });
    }

    const token = jwt.sign(
      { id: user._id, role: user.role, name: user.name, residentId: user.residentId, tenantId: user.tenantId },
      JWT_SECRET,
      {
        expiresIn: JWT_EXPIRES_IN,
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE
      }
    );

    logRequest("info", req, "Login succeeded", {
      loginKey,
      authenticatedUserId: String(user._id),
      authenticatedRole: user.role,
      tenantId: String(user.tenantId)
    });
    const session = await EmployeeSession.create({
      tenantId: user.tenantId,
      userId: user._id
    });
    res.json({
      message: "Login successful",
      token,
      user,
      tenantId: String(user.tenantId),
      sessionId: String(session._id)
    });
  } catch (err) {
    incrementLoginFailure("exception");
    res.status(500).json({ error: err.message });
  }
});

router.post("/logout", auth, auth.requireRole("admin", "medtech", "rn", "poa"), async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (typeof sessionId !== "string" || !mongoose.Types.ObjectId.isValid(sessionId)) {
      return res.status(400).json({ error: "A valid sessionId is required" });
    }

    const session = await EmployeeSession.findOneAndUpdate({
      _id: sessionId,
      tenantId: req.tenantId,
      userId: req.user.id,
      logoutAt: null
    }, { $set: { logoutAt: new Date() } });

    if (!session) {
      return res.status(404).json({ error: "Active login session not found" });
    }
    return res.json({ message: "Logout recorded" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");
const bcrypt = require("bcryptjs");
require("dotenv").config();

const User = require("./models/User");
const Resident = require("./models/Resident");
const Tenant = require("./models/Tenant");
const Medication = require("./models/Medication");
const MarEntry = require("./models/MarsEntry");
const Invoice = require("./models/Invoice");
const DashboardSettings = require("./models/DashboardSettings");
const AlertChart = require("./models/AlertChart");

const residentRoutes = require("./routes/residentRoutes");
const authRoutes = require("./routes/authRoutes");
const alertRoutes = require("./routes/alertRoutes");
const medicationRoutes = require("./routes/medicationRoutes");
const marRoutes = require("./routes/marRoutes");
const invoiceRoutes = require("./routes/invoiceRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const auth = require("./middleware/auth");
const { notFoundHandler, errorHandler } = require("./middleware/errorHandler");

const app = express();

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const MONGODB_URI = requireEnv("MONGODB_URI");
requireEnv("JWT_SECRET");

const IS_DEV = process.env.NODE_ENV === "development";
const SHOULD_SEED_ON_BOOT = process.env.SEED_ON_BOOT === "true";
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || "1mb";
const URLENCODED_BODY_LIMIT = process.env.URLENCODED_BODY_LIMIT || "1mb";
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 300);
const AUTH_RATE_LIMIT_WINDOW_MS = Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000);
const AUTH_RATE_LIMIT_MAX = Number(process.env.AUTH_RATE_LIMIT_MAX || 100);
const DEFAULT_TENANT_SLUG = (process.env.DEFAULT_TENANT_SLUG || "default").trim().toLowerCase();
const DEFAULT_TENANT_NAME = (process.env.DEFAULT_TENANT_NAME || "Default Organization").trim();
const MIGRATE_TENANTS_ON_BOOT = process.env.MIGRATE_TENANTS_ON_BOOT !== "false";
const TRUST_PROXY = process.env.TRUST_PROXY === "true";
const CORS_ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

if (!IS_DEV && CORS_ALLOWED_ORIGINS.length === 0) {
  throw new Error("Missing required environment variable: CORS_ALLOWED_ORIGINS");
}

const corsOptions = {
  origin(origin, callback) {
    // Allow requests from tools or same-origin requests with no origin header.
    if (!origin) {
      return callback(null, true);
    }

    if (CORS_ALLOWED_ORIGINS.length === 0 && IS_DEV) {
      return callback(null, true);
    }

    if (CORS_ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error("CORS origin not allowed"));
  },
  credentials: true
};

const globalApiLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." }
});

const authRouteLimiter = rateLimit({
  windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
  max: AUTH_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many authentication requests. Please try again later." }
});

if (TRUST_PROXY) {
  app.set("trust proxy", 1);
}

// =========================
// MIDDLEWARE
// =========================
app.use(helmet());
app.use(cors(corsOptions));
app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: URLENCODED_BODY_LIMIT }));

// Serve frontend assets and uploaded files
app.use(express.static(path.join(__dirname, "..", "frontend")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "frontend", "index.html"));
});

// =========================
// ROUTES
// =========================
app.use("/auth", authRouteLimiter, authRoutes);
app.use(globalApiLimiter);
app.use(auth);
app.use("/residents", residentRoutes);
app.use("/medications", medicationRoutes);
app.use("/mar", marRoutes);
app.use("/invoices", invoiceRoutes);
app.use("/dashboard", dashboardRoutes);
app.use("/alerts", alertRoutes);
app.use(notFoundHandler);
app.use(errorHandler);

async function getOrCreateDefaultTenant() {
  let tenant = await Tenant.findOne({ slug: DEFAULT_TENANT_SLUG });
  if (!tenant) {
    tenant = await Tenant.create({
      slug: DEFAULT_TENANT_SLUG,
      name: DEFAULT_TENANT_NAME
    });
    console.log(`Created default tenant: ${tenant.slug}`);
  }
  return tenant;
}

async function backfillTenantIds(defaultTenantId) {
  const models = [
    User,
    Resident,
    Medication,
    MarEntry,
    Invoice,
    DashboardSettings,
    AlertChart
  ];

  for (const Model of models) {
    const result = await Model.updateMany(
      { tenantId: { $exists: false } },
      { $set: { tenantId: defaultTenantId } }
    );

    if ((result.modifiedCount || 0) > 0) {
      console.log(`Backfilled ${result.modifiedCount} ${Model.modelName} record(s) with tenantId.`);
    }
  }
}

async function seedDevelopmentUsers(defaultTenantId) {
  console.warn("SEED_ON_BOOT is enabled. Running development seed logic.");

  const adminEmail = "hsran91@gmail.com";
  const adminPassword = "hman123";
  const adminUsername = "admhasen";
  const existingAdmin = await User.findOne({ tenantId: defaultTenantId, email: adminEmail });

  if (!existingAdmin) {
    const hashed = await bcrypt.hash(adminPassword, 10);
    await User.create({
      tenantId: defaultTenantId,
      name: "hasen",
      username: adminUsername,
      email: adminEmail,
      password: hashed,
      role: "admin"
    });
    console.log("Seeded admin user: admhasen / hman123");
  } else {
    const updates = {};
    if (!existingAdmin.username || existingAdmin.username !== adminUsername) updates.username = adminUsername;
    if (existingAdmin.role !== "admin") updates.role = "admin";
    if (Object.keys(updates).length > 0) {
      await User.findByIdAndUpdate(existingAdmin._id, updates);
      console.log("Updated existing admin username/role to admhasen/admin");
    }

    const passwordMatches = await bcrypt.compare(adminPassword, existingAdmin.password);
    if (!passwordMatches) {
      const hashed = await bcrypt.hash(adminPassword, 10);
      await User.findByIdAndUpdate(existingAdmin._id, { password: hashed });
      console.log("Updated existing admin password to hman123");
    }
  }

  const medtechEmail = "medtech@example.com";
  const medtechUsername = "medtech1";
  const medtechPassword = "med123";
  const existingMedtech = await User.findOne({ tenantId: defaultTenantId, email: medtechEmail });

  if (!existingMedtech) {
    const hashed = await bcrypt.hash(medtechPassword, 10);
    await User.create({
      tenantId: defaultTenantId,
      name: "Med Tech",
      username: medtechUsername,
      email: medtechEmail,
      password: hashed,
      role: "medtech"
    });
    console.log("Seeded medtech user: medtech1 / med123");
  }

  const poaEmail = "poa@example.com";
  const poaUsername = "respoa";
  const poaPassword = "poa123";
  const residentName = "Test Resident";
  const residentRoom = "101";
  const existingPoa = await User.findOne({ tenantId: defaultTenantId, email: poaEmail });

  let poaResidentId;
  if (!existingPoa) {
    let resident = await Resident.findOne({ tenantId: defaultTenantId, firstName: residentName, roomNumber: residentRoom });
    if (!resident) {
      resident = await Resident.create({
        tenantId: defaultTenantId,
        firstName: residentName,
        lastName: "Billing",
        roomNumber: residentRoom
      });
    }
    poaResidentId = resident._id;
    const hashed = await bcrypt.hash(poaPassword, 10);
    await User.create({
      tenantId: defaultTenantId,
      name: "POA User",
      username: poaUsername,
      email: poaEmail,
      password: hashed,
      role: "poa",
      residentId: poaResidentId
    });
    console.log("Seeded POA user: respoa / poa123");
  } else {
    poaResidentId = existingPoa.residentId;
    const passwordMatches = await bcrypt.compare(poaPassword, existingPoa.password);
    if (!passwordMatches) {
      const hashed = await bcrypt.hash(poaPassword, 10);
      await User.findByIdAndUpdate(existingPoa._id, { password: hashed });
      console.log("Updated existing POA password to poa123");
    }
    if (!existingPoa.residentId) {
      let resident = await Resident.findOne({ tenantId: defaultTenantId, firstName: residentName, roomNumber: residentRoom });
      if (!resident) {
        resident = await Resident.create({
          tenantId: defaultTenantId,
          firstName: residentName,
          lastName: "Billing",
          roomNumber: residentRoom
        });
      }
      poaResidentId = resident._id;
      await User.findByIdAndUpdate(existingPoa._id, { residentId: poaResidentId });
      console.log("Updated existing POA user resident link");
    }
  }
}

// =========================
// DATABASE CONNECTION
// =========================
const PORT = Number(process.env.PORT) || 5000;

mongoose
  .connect(MONGODB_URI)
  .then(async () => {
    console.log("MongoDB connected");

    const defaultTenant = await getOrCreateDefaultTenant();

    if (MIGRATE_TENANTS_ON_BOOT) {
      await backfillTenantIds(defaultTenant._id);
    }

    if (IS_DEV && SHOULD_SEED_ON_BOOT) {
      await seedDevelopmentUsers(defaultTenant._id);
    } else {
      console.log("Startup seed skipped. Set NODE_ENV=development and SEED_ON_BOOT=true to enable.");
    }

    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch((err) => {
    console.error("MongoDB connection error:", err);
    process.exit(1);
  });

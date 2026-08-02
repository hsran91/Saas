const mongoose = require("mongoose");
require("dotenv").config();

const Tenant = require("../models/Tenant");
const User = require("../models/User");
const Resident = require("../models/Resident");
const Medication = require("../models/Medication");
const MarEntry = require("../models/MarsEntry");
const Invoice = require("../models/Invoice");
const DashboardSettings = require("../models/DashboardSettings");
const AlertChart = require("../models/AlertChart");

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/emar";
const DEFAULT_TENANT_SLUG = (process.env.DEFAULT_TENANT_SLUG || "default").trim().toLowerCase();
const DEFAULT_TENANT_NAME = (process.env.DEFAULT_TENANT_NAME || "Default Organization").trim();

async function getOrCreateDefaultTenant() {
  let tenant = await Tenant.findOne({ slug: DEFAULT_TENANT_SLUG });
  if (!tenant) {
    tenant = await Tenant.create({ slug: DEFAULT_TENANT_SLUG, name: DEFAULT_TENANT_NAME });
    console.log(`Created tenant ${tenant.slug}`);
  }
  return tenant;
}

async function backfill(defaultTenantId) {
  const models = [User, Resident, Medication, MarEntry, Invoice, DashboardSettings, AlertChart];

  for (const Model of models) {
    const result = await Model.updateMany(
      { tenantId: { $exists: false } },
      { $set: { tenantId: defaultTenantId } }
    );
    console.log(`${Model.modelName}: modified ${result.modifiedCount || 0}`);
  }
}

async function ensureIndexes() {
  const models = [Tenant, User, Resident, Medication, MarEntry, Invoice, DashboardSettings, AlertChart];
  for (const Model of models) {
    await Model.syncIndexes();
    console.log(`${Model.modelName}: indexes synced`);
  }
}

async function run() {
  await mongoose.connect(MONGODB_URI);
  console.log("MongoDB connected");

  const tenant = await getOrCreateDefaultTenant();
  await backfill(tenant._id);
  await ensureIndexes();

  console.log("Tenant backfill complete");
  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error("Tenant backfill failed:", err);
  try {
    await mongoose.disconnect();
  } catch (disconnectErr) {
    console.error("Error during disconnect:", disconnectErr);
  }
  process.exit(1);
});

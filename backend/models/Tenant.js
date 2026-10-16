const mongoose = require("mongoose");

const TenantSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, trim: true, lowercase: true, unique: true },
  stripeAccountId: { type: String, default: "" }
}, { timestamps: true });

module.exports = mongoose.model("Tenant", TenantSchema);
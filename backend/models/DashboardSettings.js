const mongoose = require("mongoose");

const DashboardSettingsSchema = new mongoose.Schema({
  quickStats: { type: String, default: "Monitor residents, medications, and MAR activity at a glance." },
  todaysFocus: { type: String, default: "Use the Residents and MAR sections to manage today’s passes." },
}, { timestamps: true });

module.exports = mongoose.model("DashboardSettings", DashboardSettingsSchema);

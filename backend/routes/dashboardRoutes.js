const express = require("express");
const mongoose = require("mongoose");
const auth = require("../middleware/auth");
const DashboardSettings = require("../models/DashboardSettings");
const EmployeeSession = require("../models/EmployeeSession");
const User = require("../models/User");

const router = express.Router();

const getSettings = async (tenantId) => {
  let settings = await DashboardSettings.findOne({ tenantId });
  if (!settings) {
    settings = await DashboardSettings.create({ tenantId });
  }
  return settings;
};

router.get("/", auth.requireRole("admin", "medtech", "rn", "poa"), async (req, res) => {
  try {
    const settings = await getSettings(req.tenantId);
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/", auth.requireRole("admin"), async (req, res) => {
  try {
    const { quickStats, todaysFocus } = req.body;
    const settings = await getSettings(req.tenantId);

    if (typeof quickStats === "string") settings.quickStats = quickStats;
    if (typeof todaysFocus === "string") settings.todaysFocus = todaysFocus;

    await settings.save();
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/employees", auth.requireRole("admin"), async (req, res) => {
  try {
    const employees = await User.find({
      tenantId: req.tenantId,
      role: { $in: ["admin", "medtech", "rn"] }
    }).select("name role").sort({ name: 1 }).lean();

    res.json(employees.map(({ _id, name, role }) => ({
      id: String(_id),
      name,
      role
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/employees/:employeeId/sessions", auth.requireRole("admin"), async (req, res) => {
  try {
    const { employeeId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(employeeId)) {
      return res.status(400).json({ error: "A valid employeeId is required" });
    }

    const employee = await User.findOne({
      _id: employeeId,
      tenantId: req.tenantId,
      role: { $in: ["admin", "medtech", "rn"] }
    }).select("_id");
    if (!employee) {
      return res.status(404).json({ error: "Employee not found" });
    }

    const sessions = await EmployeeSession.find({
      tenantId: req.tenantId,
      userId: employee._id
    }).select("loginAt logoutAt").sort({ loginAt: -1 }).limit(100).lean();

    res.json(sessions.map(({ _id, loginAt, logoutAt }) => ({
      id: String(_id),
      loginAt,
      logoutAt
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

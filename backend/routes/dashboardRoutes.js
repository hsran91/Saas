const express = require("express");
const auth = require("../middleware/auth");
const DashboardSettings = require("../models/DashboardSettings");

const router = express.Router();

const getSettings = async () => {
  let settings = await DashboardSettings.findOne();
  if (!settings) {
    settings = await DashboardSettings.create({});
  }
  return settings;
};

router.get("/", auth.requireRole("admin", "medtech", "rn", "poa"), async (req, res) => {
  try {
    const settings = await getSettings();
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/", auth.requireRole("admin"), async (req, res) => {
  try {
    const { quickStats, todaysFocus } = req.body;
    const settings = await getSettings();

    if (typeof quickStats === "string") settings.quickStats = quickStats;
    if (typeof todaysFocus === "string") settings.todaysFocus = todaysFocus;

    await settings.save();
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

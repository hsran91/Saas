const express = require("express");
const router = express.Router();
const AlertChart = require("../models/AlertChart");
const Resident = require("../models/Resident");
const auth = require("../middleware/auth");

// Create an alert chart entry
router.post("/", auth.requireRole("admin", "medtech", "rn"), async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const { residentId, type, notes, staffName, staffId } = req.body;

    if (!residentId || !type) {
      return res.status(400).json({ error: "residentId and type are required" });
    }

    const resident = await Resident.findOne({ _id: residentId, tenantId }).select("_id").lean();
    if (!resident) {
      return res.status(404).json({ error: "Resident not found" });
    }

    const alert = new AlertChart({
      tenantId,
      residentId,
      type,
      notes,
      userId: staffId || undefined,
      userName: staffName || undefined,
      alertTime: new Date()
    });

    await alert.save();
    res.json(alert);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get alerts for a single resident (optionally limited to last N hours via ?hours=72)
router.get("/:residentId", auth.requireRole("admin", "medtech", "rn", "poa"), async (req, res) => {
  try {
    const tenantId = req.tenantId;
    if (req.user.role === "poa" && String(req.user.residentId) !== String(req.params.residentId)) {
      return res.status(403).json({ error: "Access denied" });
    }

    const { residentId } = req.params;
    const hours = Number(req.query.hours) || 72;
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const alerts = await AlertChart.find({ tenantId, residentId, createdAt: { $gte: since } })
      .sort({ createdAt: -1 });

    res.json(alerts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get recent alerts across all residents (last N hours)
router.get("/recent/all", auth.requireRole("admin", "medtech", "rn"), async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const hours = Number(req.query.hours) || 72;
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const alerts = await AlertChart.find({ tenantId, createdAt: { $gte: since } })
      .sort({ createdAt: -1 })
      .limit(200)
      .populate("residentId", "firstName lastName roomNumber");

    res.json(alerts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

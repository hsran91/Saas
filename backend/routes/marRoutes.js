const express = require("express");
const router = express.Router();
const MarEntry = require("../models/MarsEntry");
const auth = require("../middleware/auth");

router.get("/:residentId", auth.requireRole("admin", "medtech", "rn", "poa"), async (req, res) => {
  try {
    if (req.user.role === "poa" && String(req.user.residentId) !== String(req.params.residentId)) {
      return res.status(403).json({ error: "Access denied" });
    }

    const entries = await MarEntry.find({ residentId: req.params.residentId })
      .sort({ actualTime: -1 })
      .populate("medicationId", "name");

    res.json(entries);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get recent MAR entries across all residents (optional ?limit=100)
router.get("/", auth.requireRole("admin", "medtech", "rn"), async (req, res) => {
  try {
    const limit = Math.min(500, Number(req.query.limit) || 200);

    const entries = await MarEntry.find()
      .sort({ actualTime: -1 })
      .limit(limit)
      .populate("medicationId", "name")
      .populate({ path: "residentId", select: "firstName lastName roomNumber" });

    res.json(entries);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/", auth.requireRole("admin", "medtech", "rn"), async (req, res) => {
  try {
    const {
      residentId,
      medicationId,
      scheduledTime,
      status = "given",
      staffId = "000000000000000000000000",
      staffName = "Medication Tech",
      notes,
      reason
    } = req.body;

    if (!residentId || !medicationId || !scheduledTime) {
      return res
        .status(400)
        .json({ error: "residentId, medicationId and scheduledTime are required" });
    }

    const entry = new MarEntry({
      residentId,
      medicationId,
      scheduledTime,
      status,
      staffId,
      staffName,
      notes,
      reason
    });

    await entry.save();

    res.json(entry);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;

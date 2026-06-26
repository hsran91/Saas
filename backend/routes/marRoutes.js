const express = require("express");
const router = express.Router();
const MarEntry = require("../models/MarsEntry");

router.get("/:residentId", async (req, res) => {
  try {
    const entries = await MarEntry.find({ residentId: req.params.residentId })
      .sort({ actualTime: -1 })
      .populate("medicationId", "name");

    res.json(entries);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/", async (req, res) => {
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

const express = require("express");
const Medication = require("../models/Medication");
const router = express.Router();

// Add medication to a resident
router.post("/", async (req, res) => {
  try {
    const med = await Medication.create(req.body);
    res.json(med);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all meds for a resident
router.get("/resident/:residentId", async (req, res) => {
  const meds = await Medication.find({ residentId: req.params.residentId });
  res.json(meds);
});

// Update medication
router.put("/:id", async (req, res) => {
  const med = await Medication.findByIdAndUpdate(req.params.id, req.body, { new: true });
  res.json(med);
});

// Discontinue medication
router.put("/:id/discontinue", async (req, res) => {
  const med = await Medication.findByIdAndUpdate(
    req.params.id,
    { status: "discontinued", endDate: new Date() },
    { new: true }
  );
  res.json(med);
});

module.exports = router;

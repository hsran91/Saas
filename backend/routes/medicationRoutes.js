const express = require('express');
const router = express.Router();
const Medication = require('../models/Medication');

// Add medication
router.post('/add', async (req, res) => {
  try {
    const med = new Medication(req.body);
    await med.save();
    res.json({ message: "Medication added", med });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get all medications
router.get('/', async (req, res) => {
  const meds = await Medication.find();
  res.json(meds);
});

module.exports = router;

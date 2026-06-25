const express = require('express');
const router = express.Router();
const Medication = require('../models/Medication');

// Create a medication (expects residentId in body)
router.post('/', async (req, res) => {
  try {
    const med = new Medication(req.body);
    await med.save();
    res.json(med);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get medications for a resident
router.get('/:residentId', async (req, res) => {
  try {
    const meds = await Medication.find({ residentId: req.params.residentId });
    res.json(meds);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;

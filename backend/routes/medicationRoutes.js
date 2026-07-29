const express = require('express');
const router = express.Router();
const Medication = require('../models/Medication');
const auth = require('../middleware/auth');

// Create a medication (expects residentId in body)
router.post('/', auth.requireRole('admin', 'medtech', 'rn'), async (req, res) => {
  try {
    const { residentId } = req.body;
    if (!residentId) {
      return res.status(400).json({ error: 'residentId is required' });
    }

    if (req.user.role === 'poa' && String(req.user.residentId) !== String(residentId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const med = new Medication(req.body);
    await med.save();
    res.json(med);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get medications for a resident
router.get('/:residentId', auth.requireRole('admin', 'medtech', 'rn', 'poa'), async (req, res) => {
  try {
    if (req.user.role === 'poa' && String(req.user.residentId) !== String(req.params.residentId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const meds = await Medication.find({ residentId: req.params.residentId });
    res.json(meds);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;

const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Medication = require('../models/Medication');
const Resident = require('../models/Resident');
const auth = require('../middleware/auth');

const ALLOWED_MEDICATION_FIELDS = new Set([
  'name',
  'dosage',
  'route',
  'frequency',
  'time',
  'times',
  'instructions',
  'residentId',
  'status',
  'startDate',
  'endDate'
]);

const MEDICATION_ALLOWED_STATUSES = new Set(['active', 'inactive', 'on-hold', 'discontinued']);
const MEDICATION_TIME_PATTERN = /^((0?[1-9]|1[0-2]):[0-5][0-9]\s?(AM|PM)|([01]?[0-9]|2[0-3]):[0-5][0-9])$/i;

function normalizeOptionalStringField(value, fieldName, maxLength) {
  if (value == null) return undefined;
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a string`);
  }

  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.length > maxLength) {
    throw new Error(`${fieldName} must be ${maxLength} characters or fewer`);
  }
  return trimmed;
}

function parseDateField(value, fieldName) {
  if (value == null || value === '') return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${fieldName} must be a valid date`);
  }
  return parsed;
}

function validateMedicationTimes(times) {
  if (!Array.isArray(times) || !times.length) {
    throw new Error('times must be a non-empty array of time strings');
  }

  return times.map((entry) => {
    if (typeof entry !== 'string') {
      throw new Error('Each times entry must be a string');
    }

    const normalized = entry.trim();
    if (!normalized) {
      throw new Error('Each times entry must be a non-empty string');
    }

    if (!MEDICATION_TIME_PATTERN.test(normalized)) {
      throw new Error(`Invalid medication time format: ${normalized}`);
    }
    return normalized.toUpperCase().replace(/\s+/, ' ');
  });
}

function validateAndNormalizeMedicationPayload(body, options = {}) {
  const { isUpdate = false } = options;

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Request body must be an object');
  }

  const unsupportedFields = Object.keys(body).filter((key) => !ALLOWED_MEDICATION_FIELDS.has(key));
  if (unsupportedFields.length) {
    throw new Error(`Unsupported field(s): ${unsupportedFields.join(', ')}`);
  }

  if (isUpdate && !Object.keys(body).length) {
    throw new Error('At least one field is required for update');
  }

  const payload = {};

  if (!isUpdate || Object.prototype.hasOwnProperty.call(body, 'residentId')) {
    if (isUpdate) {
      throw new Error('residentId cannot be changed after medication creation');
    }

    if (!body.residentId || typeof body.residentId !== 'string') {
      throw new Error('residentId is required');
    }
    const residentId = body.residentId.trim();
    if (!mongoose.Types.ObjectId.isValid(residentId)) {
      throw new Error('residentId must be a valid id');
    }
    payload.residentId = residentId;
  }

  if (!isUpdate || Object.prototype.hasOwnProperty.call(body, 'name')) {
    if (typeof body.name !== 'string' || !body.name.trim()) {
      throw new Error('name is required');
    }
    const name = body.name.trim();
    if (name.length > 120) {
      throw new Error('name must be 120 characters or fewer');
    }
    payload.name = name;
  }

  const optionalStringFields = [
    ['dosage', 'dosage', 120],
    ['route', 'route', 80],
    ['frequency', 'frequency', 80],
    ['instructions', 'instructions', 1000],
    ['time', 'time', 30]
  ];

  optionalStringFields.forEach(([field, label, maxLength]) => {
    if (!isUpdate || Object.prototype.hasOwnProperty.call(body, field)) {
      const normalized = normalizeOptionalStringField(body[field], label, maxLength);
      if (normalized !== undefined) {
        if (field === 'time' && normalized && !MEDICATION_TIME_PATTERN.test(normalized)) {
          throw new Error('time must use HH:MM (24h) or HH:MM AM/PM format');
        }
        payload[field] = field === 'time' ? normalized.toUpperCase().replace(/\s+/, ' ') : normalized;
      }
    }
  });

  if (!isUpdate || Object.prototype.hasOwnProperty.call(body, 'times')) {
    if (body.times !== undefined) {
      payload.times = validateMedicationTimes(body.times);
    }
  }

  if (!isUpdate || Object.prototype.hasOwnProperty.call(body, 'status')) {
    const status = normalizeOptionalStringField(body.status, 'status', 40);
    if (status !== undefined) {
      const normalizedStatus = status.toLowerCase();
      if (status && !MEDICATION_ALLOWED_STATUSES.has(normalizedStatus)) {
        throw new Error(`status must be one of: ${Array.from(MEDICATION_ALLOWED_STATUSES).join(', ')}`);
      }
      payload.status = normalizedStatus;
    }
  }

  if (!isUpdate || Object.prototype.hasOwnProperty.call(body, 'startDate')) {
    const startDate = parseDateField(body.startDate, 'startDate');
    if (startDate !== undefined) payload.startDate = startDate;
  }

  if (!isUpdate || Object.prototype.hasOwnProperty.call(body, 'endDate')) {
    const endDate = parseDateField(body.endDate, 'endDate');
    if (endDate !== undefined) payload.endDate = endDate;
  }

  return payload;
}

// Create a medication (expects residentId in body)
router.post('/', auth.requireRole('admin', 'medtech', 'rn'), async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const payload = validateAndNormalizeMedicationPayload(req.body);
    const { residentId } = payload;

    const resident = await Resident.findOne({ _id: residentId, tenantId }).lean();
    if (!resident) {
      return res.status(404).json({ error: 'Resident not found' });
    }

    if (req.user.role === 'poa' && String(req.user.residentId) !== String(residentId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (payload.startDate && payload.endDate && payload.endDate < payload.startDate) {
      return res.status(400).json({ error: 'endDate must be later than or equal to startDate' });
    }

    const med = new Medication({
      tenantId,
      ...payload
    });
    await med.save();
    res.json(med);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get medications for a resident
router.get('/:residentId', auth.requireRole('admin', 'medtech', 'rn'), async (req, res) => {
  try {
    const meds = await Medication.find({ tenantId: req.tenantId, residentId: req.params.residentId }).sort({ createdAt: -1 });
    res.json(meds);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update a medication
router.put('/:id', auth.requireRole('admin', 'medtech', 'rn'), async (req, res) => {
  try {
    const med = await Medication.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!med) {
      return res.status(404).json({ error: 'Medication not found' });
    }

    const payload = validateAndNormalizeMedicationPayload(req.body, { isUpdate: true });

    if (payload.endDate && !payload.startDate && med.startDate && payload.endDate < med.startDate) {
      return res.status(400).json({ error: 'endDate must be later than or equal to startDate' });
    }
    if (payload.startDate && !payload.endDate && med.endDate && med.endDate < payload.startDate) {
      return res.status(400).json({ error: 'startDate must be earlier than or equal to endDate' });
    }
    if (payload.startDate && payload.endDate && payload.endDate < payload.startDate) {
      return res.status(400).json({ error: 'endDate must be later than or equal to startDate' });
    }

    const fields = ['name', 'dosage', 'route', 'frequency', 'time', 'times', 'instructions', 'status', 'startDate', 'endDate'];
    fields.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(payload, field)) {
        med[field] = payload[field];
      }
    });

    await med.save();
    res.json(med);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete a medication
router.delete('/:id', auth.requireRole('admin', 'medtech', 'rn'), async (req, res) => {
  try {
    const deleted = await Medication.findOneAndDelete({ _id: req.params.id, tenantId: req.tenantId });
    if (!deleted) {
      return res.status(404).json({ error: 'Medication not found' });
    }
    res.json({ message: 'Medication deleted' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;

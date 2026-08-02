
const express = require("express");
const mongoose = require("mongoose");
const Resident = require("../models/Resident");
const { getUniqueResidentCode } = require("../utils/residentCode");
const upload = require("../middleware/upload"); // <-- Multer middleware
const auth = require("../middleware/auth");
const router = express.Router();

const RESIDENT_ALLOWED_FIELDS = new Set([
  "firstName",
  "lastName",
  "roomNumber",
  "residentCode",
  "dob",
  "allergies",
  "notes"
]);

const RESIDENT_CODE_PATTERN = /^[A-Za-z0-9_-]{3,32}$/;

function asTrimmedString(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function normalizeOptionalString(value, fieldName, maxLength) {
  if (value == null) return undefined;
  if (typeof value !== "string") {
    throw new Error(`${fieldName} must be a string.`);
  }

  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.length > maxLength) {
    throw new Error(`${fieldName} must be ${maxLength} characters or fewer.`);
  }
  return trimmed;
}

function validateAndNormalizeResidentPayload(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Request body must be an object.");
  }

  const unsupportedFields = Object.keys(body).filter((key) => !RESIDENT_ALLOWED_FIELDS.has(key));
  if (unsupportedFields.length) {
    throw new Error(`Unsupported field(s): ${unsupportedFields.join(", ")}`);
  }

  const firstName = asTrimmedString(body.firstName);
  const roomNumber = asTrimmedString(body.roomNumber);
  const residentCode = asTrimmedString(body.residentCode);

  if (!firstName) {
    throw new Error("First name is required.");
  }
  if (firstName.length > 80) {
    throw new Error("First name must be 80 characters or fewer.");
  }

  if (!roomNumber) {
    throw new Error("Room number is required.");
  }
  if (roomNumber.length > 40) {
    throw new Error("Room number must be 40 characters or fewer.");
  }

  if (!residentCode) {
    throw new Error("Resident code is required.");
  }
  if (!RESIDENT_CODE_PATTERN.test(residentCode)) {
    throw new Error("Resident code must be 3-32 characters and only include letters, numbers, underscores, or dashes.");
  }

  const lastName = normalizeOptionalString(body.lastName, "Last name", 80);
  const allergies = normalizeOptionalString(body.allergies, "Allergies", 500);
  const notes = normalizeOptionalString(body.notes, "Notes", 2000);

  let dob;
  if (Object.prototype.hasOwnProperty.call(body, "dob") && body.dob != null && body.dob !== "") {
    const parsedDob = new Date(body.dob);
    if (Number.isNaN(parsedDob.getTime())) {
      throw new Error("dob must be a valid date.");
    }
    dob = parsedDob;
  }

  const payload = {
    firstName,
    roomNumber,
    residentCode,
    lastName: lastName || ""
  };

  if (allergies !== undefined) payload.allergies = allergies;
  if (notes !== undefined) payload.notes = notes;
  if (dob !== undefined) payload.dob = dob;

  return payload;
}

// =========================
// ADD RESIDENT (with photo)
// =========================
router.post("/", auth.requireRole("admin", "medtech", "rn"), upload.single("photo"), async (req, res) => {
  console.log("POST /residents received", {
    body: req.body,
    file: req.file ? { originalname: req.file.originalname, filename: req.file.filename } : null,
    mongooseState: mongoose.connection.readyState
  });

  try {
    const tenantId = req.tenantId;
    const payload = validateAndNormalizeResidentPayload(req.body);

    const existing = await Resident.findOne({ tenantId, residentCode: payload.residentCode }).lean();
    if (existing) {
      return res.status(400).json({ error: "Resident code already in use." });
    }

    const resident = await Resident.create({
      tenantId,
      ...payload,
      photoUrl: req.file ? `/uploads/${req.file.filename}` : null
    });

    const out = resident.toObject();
    if (req.user.role !== "admin") delete out.residentCode;
    res.json(out);
  } catch (err) {
    console.error("Error creating resident:", err);
    res.status(400).json({ error: err.message });
  }
});

// =========================
// GET ALL RESIDENTS
// =========================
router.get("/", auth.requireRole("admin", "medtech", "rn", "poa"), async (req, res) => {
  try {
    const tenantId = req.tenantId;
    if (req.user.role === "poa") {
      const resident = await Resident.findOne({ _id: req.user.residentId, tenantId });
      if (resident && !resident.residentCode) {
        resident.residentCode = await getUniqueResidentCode(Resident, tenantId);
        await resident.save();
      }
      const out = resident ? resident.toObject() : null;
      if (out && req.user.role !== "admin") delete out.residentCode;
      return res.json(out ? [out] : []);
    }

    const residents = await Resident.find({ tenantId });
    const updatedResidents = await Promise.all(residents.map(async r => {
      if (!r.residentCode) {
        r.residentCode = await getUniqueResidentCode(Resident, tenantId);
        await r.save();
      }
      const obj = r.toObject();
      if (req.user.role !== "admin") delete obj.residentCode;
      return obj;
    }));
    res.json(updatedResidents);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =========================
// GET SINGLE RESIDENT
// =========================
router.get("/:id", auth.requireRole("admin", "medtech", "rn", "poa"), async (req, res) => {
  try {
    const tenantId = req.tenantId;
    if (req.user.role === "poa" && String(req.user.residentId) !== String(req.params.id)) {
      return res.status(403).json({ error: "Access denied" });
    }
    const resident = await Resident.findOne({ _id: req.params.id, tenantId });
    if (resident && !resident.residentCode) {
      resident.residentCode = await getUniqueResidentCode(Resident, tenantId);
      await resident.save();
    }
    const out = resident ? resident.toObject() : null;
    if (out && req.user.role !== "admin") delete out.residentCode;
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =========================
// DELETE RESIDENT
// =========================
router.delete("/:id", auth.requireRole("admin", "medtech", "rn"), async (req, res) => {
  try {
    const deleted = await Resident.findOneAndDelete({ _id: req.params.id, tenantId: req.tenantId });
    if (!deleted) {
      return res.status(404).json({ error: "Resident not found" });
    }
    res.json({ message: "Resident deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

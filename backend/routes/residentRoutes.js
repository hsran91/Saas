
const express = require("express");
const mongoose = require("mongoose");
const Resident = require("../models/Resident");
const { getUniqueResidentCode } = require("../utils/residentCode");
const upload = require("../middleware/upload"); // <-- Multer middleware
const auth = require("../middleware/auth");
const router = express.Router();

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
    let residentCode = req.body.residentCode && req.body.residentCode.trim();
    if (!residentCode) {
      return res.status(400).json({ error: "Resident code is required." });
    }

    const existing = await Resident.findOne({ residentCode }).lean();
    if (existing) {
      return res.status(400).json({ error: "Resident code already in use." });
    }

    const resident = await Resident.create({
      firstName: req.body.firstName,
      lastName: req.body.lastName || "",
      roomNumber: req.body.roomNumber,
      residentCode,
      photoUrl: req.file ? `/uploads/${req.file.filename}` : null
    });

    const out = resident.toObject();
    if (req.user.role !== "admin") delete out.residentCode;
    res.json(out);
  } catch (err) {
    console.error("Error creating resident:", err);
    res.status(500).json({ error: err.message });
  }
});

// =========================
// GET ALL RESIDENTS
// =========================
router.get("/", auth.requireRole("admin", "medtech", "rn", "poa"), async (req, res) => {
  try {
    if (req.user.role === "poa") {
      const resident = await Resident.findById(req.user.residentId);
      if (resident && !resident.residentCode) {
        resident.residentCode = await getUniqueResidentCode(Resident);
        await resident.save();
      }
      const out = resident ? resident.toObject() : null;
      if (out && req.user.role !== "admin") delete out.residentCode;
      return res.json(out ? [out] : []);
    }

    const residents = await Resident.find();
    const updatedResidents = await Promise.all(residents.map(async r => {
      if (!r.residentCode) {
        r.residentCode = await getUniqueResidentCode(Resident);
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
    if (req.user.role === "poa" && String(req.user.residentId) !== String(req.params.id)) {
      return res.status(403).json({ error: "Access denied" });
    }
    const resident = await Resident.findById(req.params.id);
    if (resident && !resident.residentCode) {
      resident.residentCode = await getUniqueResidentCode(Resident);
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
    await Resident.findByIdAndDelete(req.params.id);
    res.json({ message: "Resident deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

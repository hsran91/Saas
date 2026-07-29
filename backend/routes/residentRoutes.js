
const express = require("express");
const mongoose = require("mongoose");
const Resident = require("../models/Resident");
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
    const resident = await Resident.create({
      firstName: req.body.firstName,
      lastName: req.body.lastName || "",
      roomNumber: req.body.roomNumber,
      photoUrl: req.file ? `/uploads/${req.file.filename}` : null
    });

    res.json(resident);
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
      return res.json(resident ? [resident] : []);
    }
    const residents = await Resident.find();
    res.json(residents);
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
    res.json(resident);
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

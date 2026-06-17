
const express = require("express");
const mongoose = require("mongoose");
const Resident = require("../models/Resident");
const upload = require("../middleware/upload"); // <-- Multer middleware
const router = express.Router();

// =========================
// ADD RESIDENT (with photo)
// =========================
router.post("/", upload.single("photo"), async (req, res) => {
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
router.get("/", async (req, res) => {
  try {
    const residents = await Resident.find();
    res.json(residents);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =========================
// GET SINGLE RESIDENT
// =========================
router.get("/:id", async (req, res) => {
  try {
    const resident = await Resident.findById(req.params.id);
    res.json(resident);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =========================
// DELETE RESIDENT
// =========================
router.delete("/:id", async (req, res) => {
  try {
    await Resident.findByIdAndDelete(req.params.id);
    res.json({ message: "Resident deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

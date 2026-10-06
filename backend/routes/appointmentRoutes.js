const express = require("express");
const mongoose = require("mongoose");
const Appointment = require("../models/Appointment");
const Resident = require("../models/Resident");
const auth = require("../middleware/auth");
const { logRequest, serializeError } = require("../utils/logger");

const router = express.Router();
const APPOINTMENT_ALLOWED_FIELDS = new Set(["residentId", "appointmentType", "description", "date", "time"]);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function validateAndNormalizeAppointmentPayload(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Request body must be an object.");
  }

  const unsupportedFields = Object.keys(body).filter((key) => !APPOINTMENT_ALLOWED_FIELDS.has(key));
  if (unsupportedFields.length) {
    throw new Error(`Unsupported field(s): ${unsupportedFields.join(", ")}`);
  }

  const residentId = typeof body.residentId === "string" ? body.residentId.trim() : "";
  const appointmentType = typeof body.appointmentType === "string" ? body.appointmentType.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const date = typeof body.date === "string" ? body.date.trim() : "";
  const time = typeof body.time === "string" ? body.time.trim() : "";

  if (!mongoose.Types.ObjectId.isValid(residentId)) {
    throw new Error("residentId must be a valid id.");
  }
  if (!appointmentType || appointmentType.length > 100) {
    throw new Error("Appointment type is required and must be 100 characters or fewer.");
  }
  if (!description || description.length > 2000) {
    throw new Error("Description is required and must be 2000 characters or fewer.");
  }
  if (!DATE_PATTERN.test(date)) {
    throw new Error("date must be a valid date in YYYY-MM-DD format.");
  }
  const [year, month, day] = date.split("-").map(Number);
  const parsedDate = new Date(Date.UTC(year, month - 1, day));
  if (parsedDate.getUTCFullYear() !== year || parsedDate.getUTCMonth() !== month - 1 || parsedDate.getUTCDate() !== day) {
    throw new Error("date must be a valid date in YYYY-MM-DD format.");
  }
  if (!TIME_PATTERN.test(time)) {
    throw new Error("time must be a valid time in 24-hour HH:MM format.");
  }

  return { residentId, appointmentType, description, date: parsedDate, time };
}

router.get("/:residentId", auth.requireRole("admin", "medtech", "rn", "poa"), async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.residentId)) {
      return res.status(400).json({ error: "residentId must be a valid id." });
    }
    if (req.user.role === "poa" && String(req.user.residentId) !== String(req.params.residentId)) {
      return res.status(403).json({ error: "Access denied." });
    }

    const resident = await Resident.findOne({ _id: req.params.residentId, tenantId: req.tenantId }).select("_id").lean();
    if (!resident) {
      return res.status(404).json({ error: "Resident not found." });
    }

    const appointments = await Appointment.find({
      tenantId: req.tenantId,
      residentId: req.params.residentId
    }).sort({ date: 1, time: 1 });

    res.json(appointments);
  } catch (err) {
    logRequest("error", req, "Appointment list failed", { error: serializeError(err) });
    res.status(500).json({ error: "Unable to load appointments." });
  }
});

router.post("/", auth.requireRole("admin", "medtech", "rn", "poa"), async (req, res) => {
  let payload;
  try {
    payload = validateAndNormalizeAppointmentPayload(req.body);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  if (req.user.role === "poa" && String(req.user.residentId) !== payload.residentId) {
    return res.status(403).json({ error: "Access denied." });
  }

  try {
    const resident = await Resident.findOne({ _id: payload.residentId, tenantId: req.tenantId }).select("_id").lean();
    if (!resident) {
      return res.status(404).json({ error: "Resident not found." });
    }

    const appointment = await Appointment.create({
      tenantId: req.tenantId,
      createdBy: req.user.id,
      ...payload
    });
    res.status(201).json(appointment);
  } catch (err) {
    logRequest("error", req, "Appointment create failed", { error: serializeError(err) });
    res.status(500).json({ error: "Unable to save appointment." });
  }
});

router.patch("/:appointmentId", auth.requireRole("admin", "medtech", "rn", "poa"), async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.appointmentId)) {
    return res.status(400).json({ error: "appointmentId must be a valid id." });
  }

  let payload;
  try {
    payload = validateAndNormalizeAppointmentPayload(req.body);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  if (req.user.role === "poa" && String(req.user.residentId) !== payload.residentId) {
    return res.status(403).json({ error: "Access denied." });
  }

  try {
    const resident = await Resident.findOne({ _id: payload.residentId, tenantId: req.tenantId }).select("_id").lean();
    if (!resident) {
      return res.status(404).json({ error: "Resident not found." });
    }

    const filter = {
      _id: req.params.appointmentId,
      tenantId: req.tenantId,
      residentId: payload.residentId
    };
    if (req.user.role === "poa") filter.createdBy = req.user.id;
    const appointment = await Appointment.findOneAndUpdate(
      filter,
      { $set: payload },
      { new: true, runValidators: true }
    );
    if (!appointment) {
      return res.status(req.user.role === "poa" ? 403 : 404).json({
        error: req.user.role === "poa" ? "You can only edit events you created." : "Appointment not found."
      });
    }
    res.json(appointment);
  } catch (err) {
    logRequest("error", req, "Appointment update failed", { error: serializeError(err) });
    res.status(500).json({ error: "Unable to update appointment." });
  }
});

router.delete("/:appointmentId", auth.requireRole("admin", "medtech", "rn", "poa"), async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.appointmentId)) {
      return res.status(400).json({ error: "appointmentId must be a valid id." });
    }

    const filter = {
      _id: req.params.appointmentId,
      tenantId: req.tenantId
    };
    if (req.user.role === "poa") {
      filter.residentId = req.user.residentId;
      filter.createdBy = req.user.id;
    }
    const appointment = await Appointment.findOneAndDelete(filter);
    if (!appointment) {
      return res.status(req.user.role === "poa" ? 403 : 404).json({
        error: req.user.role === "poa" ? "You can only delete events you created." : "Appointment not found."
      });
    }
    res.json({ message: "Appointment deleted." });
  } catch (err) {
    logRequest("error", req, "Appointment delete failed", { error: serializeError(err) });
    res.status(500).json({ error: "Unable to delete appointment." });
  }
});

module.exports = router;
module.exports._test = { validateAndNormalizeAppointmentPayload };

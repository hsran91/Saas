const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const MarEntry = require("../models/MarsEntry");
const Medication = require("../models/Medication");
const User = require("../models/User");
const auth = require("../middleware/auth");

const ALLOWED_MAR_WRITE_FIELDS = new Set([
  "residentId",
  "medicationId",
  "scheduledTime",
  "status",
  "notes",
  "reason"
]);

const ALLOWED_MAR_STATUSES = new Set(["given", "held", "prn", "prn-followup", "refused"]);

function normalizeOptionalText(value, fieldName, maxLength) {
  if (value == null) return undefined;
  if (typeof value !== "string") {
    throw new Error(`${fieldName} must be a string`);
  }

  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.length > maxLength) {
    throw new Error(`${fieldName} must be ${maxLength} characters or fewer`);
  }
  return trimmed;
}

function validateAndNormalizeMarPayload(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Request body must be an object");
  }

  const unsupportedFields = Object.keys(body).filter((key) => !ALLOWED_MAR_WRITE_FIELDS.has(key));
  if (unsupportedFields.length) {
    throw new Error(`Unsupported field(s): ${unsupportedFields.join(", ")}`);
  }

  const residentId = typeof body.residentId === "string" ? body.residentId.trim() : "";
  const medicationId = typeof body.medicationId === "string" ? body.medicationId.trim() : "";
  const scheduledTime = typeof body.scheduledTime === "string" ? body.scheduledTime.trim() : "";
  const status = String(body.status || "given").trim().toLowerCase();
  const notes = normalizeOptionalText(body.notes, "notes", 2000);
  const reason = normalizeOptionalText(body.reason, "reason", 500);

  if (!residentId || !medicationId || !scheduledTime) {
    throw new Error("residentId, medicationId and scheduledTime are required");
  }

  if (!mongoose.Types.ObjectId.isValid(residentId)) {
    throw new Error("residentId must be a valid id");
  }
  if (!mongoose.Types.ObjectId.isValid(medicationId)) {
    throw new Error("medicationId must be a valid id");
  }

  if (scheduledTime.length > 60) {
    throw new Error("scheduledTime must be 60 characters or fewer");
  }

  if (!ALLOWED_MAR_STATUSES.has(status)) {
    throw new Error(`status must be one of: ${Array.from(ALLOWED_MAR_STATUSES).join(", ")}`);
  }

  if ((status === "held" || status === "prn") && !reason) {
    throw new Error("reason is required when status is held or prn");
  }

  if (status === "prn-followup" && !notes) {
    throw new Error("notes are required for prn-followup");
  }

  return {
    residentId,
    medicationId,
    scheduledTime,
    status,
    notes,
    reason
  };
}

router.get("/:residentId", auth.requireRole("admin", "medtech", "rn", "poa"), async (req, res) => {
  try {
    const tenantId = req.tenantId;
    if (req.user.role === "poa" && String(req.user.residentId) !== String(req.params.residentId)) {
      return res.status(403).json({ error: "Access denied" });
    }

    const entries = await MarEntry.find({ tenantId, residentId: req.params.residentId })
      .sort({ actualTime: -1 })
      .populate("medicationId", "name");

    res.json(entries);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get recent MAR entries across all residents (optional ?limit=100)
router.get("/", auth.requireRole("admin", "medtech", "rn"), async (req, res) => {
  try {
    const limit = Math.min(500, Number(req.query.limit) || 200);

    const entries = await MarEntry.find({ tenantId: req.tenantId })
      .sort({ actualTime: -1 })
      .limit(limit)
      .populate("medicationId", "name")
      .populate({ path: "residentId", select: "firstName lastName roomNumber" });

    res.json(entries);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/", auth.requireRole("admin", "medtech", "rn"), async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const payload = validateAndNormalizeMarPayload(req.body);
    const {
      residentId,
      medicationId,
      scheduledTime,
      status: normalizedStatus,
      notes,
      reason
    } = payload;

    const medication = await Medication.findOne({ _id: medicationId, tenantId }).lean();
    if (!medication) {
      return res.status(404).json({ error: "Medication not found" });
    }

    if (String(medication.residentId) !== String(residentId)) {
      return res.status(400).json({ error: "Medication does not belong to resident" });
    }

    if (normalizedStatus !== "prn-followup") {
      const now = new Date();
      const dayStart = new Date(now);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(now);
      dayEnd.setHours(23, 59, 59, 999);

      const existing = await MarEntry.findOne({
        tenantId,
        residentId,
        medicationId,
        scheduledTime,
        status: { $ne: "prn-followup" },
        actualTime: { $gte: dayStart, $lte: dayEnd }
      }).lean();

      if (existing) {
        return res.status(409).json({ error: "This medication pass has already been charted for today." });
      }
    }

    let resolvedStaffName = req.user.name || "Staff";
    let resolvedStaffId = req.user.id;
    if (req.user.id) {
      const dbUser = await User.findOne({ _id: req.user.id, tenantId }).select("name").lean();
      if (dbUser?.name) {
        resolvedStaffName = dbUser.name;
      }
      resolvedStaffId = req.user.id;
    }

    const entry = new MarEntry({
      tenantId,
      residentId,
      medicationId,
      scheduledTime,
      status: normalizedStatus,
      staffId: resolvedStaffId,
      staffName: resolvedStaffName,
      notes,
      reason
    });

    await entry.save();

    res.json(entry);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
module.exports._test = {
  validateAndNormalizeMarPayload
};

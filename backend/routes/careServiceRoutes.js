const express = require("express");
const mongoose = require("mongoose");
const CareService = require("../models/CareService");
const auth = require("../middleware/auth");
const { logRequest, serializeError } = require("../utils/logger");

const router = express.Router();
const ALLOWED_FIELDS = new Set(["name", "description", "amount", "active"]);

function validateCareServicePayload(body, partial = false) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Request body must be an object");
  }

  const unsupported = Object.keys(body).filter((key) => !ALLOWED_FIELDS.has(key));
  if (unsupported.length) throw new Error(`Unsupported field(s): ${unsupported.join(", ")}`);
  if (!partial && (!Object.hasOwn(body, "name") || !Object.hasOwn(body, "amount"))) {
    throw new Error("name and amount are required");
  }

  const payload = {};
  if (Object.hasOwn(body, "name")) {
    if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 120) {
      throw new Error("name must be between 1 and 120 characters");
    }
    payload.name = body.name.trim();
  }
  if (Object.hasOwn(body, "description")) {
    if (typeof body.description !== "string" || body.description.trim().length > 500) {
      throw new Error("description must be 500 characters or fewer");
    }
    payload.description = body.description.trim();
  }
  if (Object.hasOwn(body, "amount")) {
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0 || Math.round(amount * 100) !== amount * 100) {
      throw new Error("amount must be greater than zero and have no more than two decimal places");
    }
    payload.amount = amount;
  }
  if (Object.hasOwn(body, "active")) {
    if (typeof body.active !== "boolean") throw new Error("active must be a boolean");
    payload.active = body.active;
  }
  return payload;
}

router.get("/", auth.requireRole("admin"), async (req, res) => {
  try {
    res.json(await CareService.find({ tenantId: req.tenantId }).sort({ name: 1 }).lean());
  } catch (err) {
    logRequest("error", req, "Care service list failed", { error: serializeError(err) });
    res.status(500).json({ error: "Unable to load care services" });
  }
});

router.post("/", auth.requireRole("admin"), async (req, res) => {
  try {
    const payload = validateCareServicePayload(req.body);
    const service = await CareService.create({ ...payload, tenantId: req.tenantId });
    res.status(201).json(service);
  } catch (err) {
    logRequest("error", req, "Care service create failed", { error: serializeError(err) });
    res.status(err.code === 11000 ? 409 : 400).json({
      error: err.code === 11000 ? "A care service with this name already exists" : err.message
    });
  }
});

router.patch("/:serviceId", auth.requireRole("admin"), async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.serviceId)) {
      return res.status(400).json({ error: "serviceId must be a valid id" });
    }
    const payload = validateCareServicePayload(req.body, true);
    if (!Object.keys(payload).length) return res.status(400).json({ error: "At least one field is required" });
    const service = await CareService.findOneAndUpdate(
      { _id: req.params.serviceId, tenantId: req.tenantId },
      { $set: payload },
      { new: true, runValidators: true }
    );
    if (!service) return res.status(404).json({ error: "Care service not found" });
    res.json(service);
  } catch (err) {
    logRequest("error", req, "Care service update failed", { error: serializeError(err) });
    res.status(err.code === 11000 ? 409 : 400).json({
      error: err.code === 11000 ? "A care service with this name already exists" : err.message
    });
  }
});

module.exports = router;
module.exports._test = { validateCareServicePayload };

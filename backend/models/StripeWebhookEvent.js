const mongoose = require("mongoose");

const StripeWebhookEventSchema = new mongoose.Schema({
  eventId: { type: String, required: true, unique: true },
  status: { type: String, enum: ["processing", "processed"], required: true }
}, { timestamps: true });

module.exports = mongoose.model("StripeWebhookEvent", StripeWebhookEventSchema);

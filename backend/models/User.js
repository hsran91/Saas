const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Tenant",
    required: true,
    index: true
  },
  name: { type: String, required: true },
  username: { type: String, required: true },
  email: { type: String, required: true },
  password: { type: String, required: true },
  role: {
    type: String,
    enum: ["admin", "medtech", "rn", "poa"],
    default: "medtech"
  },
  residentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Resident",
    required: function () {
      return this.role === "poa";
    }
  }
}, { timestamps: true });

UserSchema.index({ tenantId: 1, username: 1 }, { unique: true });
UserSchema.index({ tenantId: 1, email: 1 }, { unique: true });

module.exports = mongoose.model("User", UserSchema);

const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
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

module.exports = mongoose.model("User", UserSchema);

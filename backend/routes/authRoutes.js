const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const auth = require("../middleware/auth");
const User = require("../models/User");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";

// REGISTER STAFF
router.post("/register", auth, auth.requireRole("admin"), async (req, res) => {
  try {
    const { name, username, email, password, role, residentId } = req.body;

    if (!name || !username || !email || !password || !role) {
      return res.status(400).json({ error: "Name, username, email, password, and role are required" });
    }

    if (role === "poa" && !residentId) {
      return res.status(400).json({ error: "POA users must be linked to a resident" });
    }

    const isValidUsername = (role, username) => {
      if (role === "admin") return username.startsWith("adm");
      if (role === "medtech" || role === "rn") return username.startsWith("med");
      if (role === "poa") return username.startsWith("res");
      return true;
    };

    if (!isValidUsername(role, username)) {
      return res.status(400).json({ error: "Username prefix does not match selected role" });
    }

    const usernameExists = await User.findOne({ username });
    if (usernameExists) return res.status(400).json({ error: "Username already in use" });

    const emailExists = await User.findOne({ email });
    if (emailExists) return res.status(400).json({ error: "Email already in use" });

    const hashed = await bcrypt.hash(password, 10);

    const user = await User.create({
      name,
      username,
      email,
      password: hashed,
      role,
      residentId: role === "poa" ? residentId : undefined,
    });

    res.json({ message: "User registered", user: { id: user._id, name: user.name, username: user.username, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// LOGIN STAFF
router.post("/login", async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const loginKey = username || email;

    if (!loginKey || !password) {
      return res.status(400).json({ error: "Username and password are required" });
    }

    let user = null;
    if (username) {
      user = await User.findOne({ username });
      if (!user && username.includes("@")) {
        user = await User.findOne({ email: username });
      }
    } else {
      user = await User.findOne({ email: loginKey });
    }

    if (!user) return res.status(400).json({ error: "Invalid credentials" });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ error: "Invalid credentials" });

    const token = jwt.sign(
      { id: user._id, role: user.role, name: user.name, residentId: user.residentId },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({ message: "Login successful", token, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

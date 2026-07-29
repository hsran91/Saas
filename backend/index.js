const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const path = require("path");
const bcrypt = require("bcryptjs");
const User = require("./models/User");

const residentRoutes = require("./routes/residentRoutes");
const authRoutes = require("./routes/authRoutes");
const alertRoutes = require("./routes/alertRoutes");
const medicationRoutes = require("./routes/medicationRoutes");
const marRoutes = require("./routes/marRoutes");
const invoiceRoutes = require("./routes/invoiceRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const auth = require("./middleware/auth");

const app = express();

// =========================
// MIDDLEWARE
// =========================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve frontend assets and uploaded files
app.use(express.static(path.join(__dirname, "..", "frontend")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "frontend", "index.html"));
});

// =========================
// ROUTES
// =========================
app.use("/auth", authRoutes);
app.use(auth);
app.use("/residents", residentRoutes);
app.use("/medications", medicationRoutes);
app.use("/mar", marRoutes);
app.use("/invoices", invoiceRoutes);
app.use("/dashboard", dashboardRoutes);
app.use("/alerts", alertRoutes);

// =========================
// DATABASE CONNECTION
// =========================
const PORT = 5000;

mongoose
  .connect("mongodb://127.0.0.1:27017/emar")
  .then(async () => {
    console.log("MongoDB connected");

    const adminEmail = "hsran91@gmail.com";
    const existingAdmin = await User.findOne({ email: adminEmail });
    const adminPassword = "hman123";
    const adminUsername = "admhasen";

    if (!existingAdmin) {
      const hashed = await bcrypt.hash(adminPassword, 10);
      await User.create({
        name: "hasen",
        username: adminUsername,
        email: adminEmail,
        password: hashed,
        role: "admin"
      });
      console.log("Seeded admin user: admhasen / hman123");
    } else {
      const updates = {};
      if (!existingAdmin.username || existingAdmin.username !== adminUsername) {
        updates.username = adminUsername;
      }
      if (existingAdmin.role !== "admin") {
        updates.role = "admin";
      }
      if (Object.keys(updates).length > 0) {
        await User.findByIdAndUpdate(existingAdmin._id, updates);
        console.log("Updated existing admin username/role to admhasen/admin");
      }

      const passwordMatches = await bcrypt.compare(adminPassword, existingAdmin.password);
      if (!passwordMatches) {
        const hashed = await bcrypt.hash(adminPassword, 10);
        await User.findByIdAndUpdate(existingAdmin._id, { password: hashed });
        console.log("Updated existing admin password to hman123");
      }
    }

    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch(err => {
    console.error("MongoDB connection error:", err);
    process.exit(1);
  });


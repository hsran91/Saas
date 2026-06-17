const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const path = require("path");

const residentRoutes = require("./routes/residentRoutes");
const medicationRoutes = require("./routes/medicationRoutes");
const marRoutes = require("./routes/marRoutes");

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
app.use("/residents", residentRoutes);
app.use("/medications", medicationRoutes);
app.use("/mar", marRoutes);

// =========================
// DATABASE CONNECTION
// =========================
const PORT = 5000;

mongoose
  .connect("mongodb://127.0.0.1:27017/emar")
  .then(() => {
    console.log("MongoDB connected");
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch(err => {
    console.error("MongoDB connection error:", err);
    process.exit(1);
  });


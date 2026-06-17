const express = require("express");
const router = express.Router();

// Temporary MAR routes stub to allow backend startup.
router.get("/:residentId", async (req, res) => {
  res.json([]);
});

module.exports = router;

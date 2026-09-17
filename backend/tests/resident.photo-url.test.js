const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadResidentPhotoUtils() {
  const scriptPath = path.join(__dirname, "..", "..", "frontend", "script.js");
  const source = fs.readFileSync(scriptPath, "utf8");
  const start = source.indexOf("function normalizeResidentPhotoUrl");
  const end = source.indexOf("function updateRoleUI");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Could not locate resident photo helper functions in frontend/script.js");
  }

  const snippet = source.slice(start, end);
  const context = {
    console,
    API_BASE: "http://localhost:5000",
    window: { location: { protocol: "http:" } },
    URL,
    setTimeout,
    clearTimeout,
    localStorage: { getItem() { return null; }, setItem() {} }
  };

  vm.runInNewContext(snippet, context);
  return context;
}

test("normalizeResidentPhotoUrl sanitizes Windows-style paths", () => {
  const context = loadResidentPhotoUtils();
  assert.equal(context.normalizeResidentPhotoUrl("uploads\\resident\\photo.png"), "/uploads/resident/photo.png");
  assert.equal(context.resolveResidentPhotoUrl("uploads\\resident\\photo.png"), "http://localhost:5000/uploads/resident/photo.png");
  assert.equal(context.normalizeResidentPhotoUrl("C:/Users/test/project/backend/uploads/resident/photo.png"), "/uploads/resident/photo.png");
  assert.equal(context.resolveResidentPhotoUrl("C:/Users/test/project/backend/uploads/resident/photo.png"), "http://localhost:5000/uploads/resident/photo.png");
});

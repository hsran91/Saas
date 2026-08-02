const test = require("node:test");
const assert = require("node:assert/strict");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.JWT_ISSUER = process.env.JWT_ISSUER || "test-issuer";
process.env.JWT_AUDIENCE = process.env.JWT_AUDIENCE || "test-audience";

const marRoutes = require("../routes/marRoutes");

const { validateAndNormalizeMarPayload } = marRoutes._test;

const validResidentId = "507f191e810c19729de860ea";
const validMedicationId = "507f1f77bcf86cd799439011";

test("MAR validator normalizes a valid payload", () => {
  const payload = validateAndNormalizeMarPayload({
    residentId: validResidentId,
    medicationId: validMedicationId,
    scheduledTime: "08:00 am",
    status: "Given",
    notes: "  done  "
  });

  assert.equal(payload.residentId, validResidentId);
  assert.equal(payload.medicationId, validMedicationId);
  assert.equal(payload.scheduledTime, "08:00 am");
  assert.equal(payload.status, "given");
  assert.equal(payload.notes, "done");
});

test("MAR validator rejects unsupported fields", () => {
  assert.throws(
    () => validateAndNormalizeMarPayload({
      residentId: validResidentId,
      medicationId: validMedicationId,
      scheduledTime: "08:00",
      status: "given",
      staffName: "Injected"
    }),
    /Unsupported field\(s\): staffName/
  );
});

test("MAR validator enforces reason and notes requirements", () => {
  assert.throws(
    () => validateAndNormalizeMarPayload({
      residentId: validResidentId,
      medicationId: validMedicationId,
      scheduledTime: "08:00",
      status: "held"
    }),
    /reason is required/
  );

  assert.throws(
    () => validateAndNormalizeMarPayload({
      residentId: validResidentId,
      medicationId: validMedicationId,
      scheduledTime: "PRN",
      status: "prn-followup"
    }),
    /notes are required/
  );
});

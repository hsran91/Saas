const test = require("node:test");
const assert = require("node:assert/strict");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.JWT_ISSUER = process.env.JWT_ISSUER || "test-issuer";
process.env.JWT_AUDIENCE = process.env.JWT_AUDIENCE || "test-audience";

const appointmentRoutes = require("../routes/appointmentRoutes");
const { validateAndNormalizeAppointmentPayload } = appointmentRoutes._test;

const validResidentId = "507f191e810c19729de860ea";

test("Appointment validator normalizes a valid appointment payload", () => {
  const payload = validateAndNormalizeAppointmentPayload({
    residentId: validResidentId,
    appointmentType: "  Doctor visit ",
    description: " Annual checkup ",
    date: "2026-10-05",
    time: "09:30"
  });

  assert.equal(payload.residentId, validResidentId);
  assert.equal(payload.appointmentType, "Doctor visit");
  assert.equal(payload.description, "Annual checkup");
  assert.equal(payload.date.toISOString(), "2026-10-05T00:00:00.000Z");
  assert.equal(payload.time, "09:30");
});

test("Appointment validator rejects invalid dates, times, and unsupported fields", () => {
  const base = {
    residentId: validResidentId,
    appointmentType: "Doctor visit",
    description: "Annual checkup",
    date: "2026-10-05",
    time: "09:30"
  };

  assert.throws(
    () => validateAndNormalizeAppointmentPayload({ ...base, date: "2026-02-30" }),
    /date must be a valid date/
  );
  assert.throws(
    () => validateAndNormalizeAppointmentPayload({ ...base, time: "25:90" }),
    /time must be a valid time/
  );
  assert.throws(
    () => validateAndNormalizeAppointmentPayload({ ...base, status: "confirmed" }),
    /Unsupported field\(s\): status/
  );
});

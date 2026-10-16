const test = require("node:test");
const assert = require("node:assert/strict");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.JWT_ISSUER = process.env.JWT_ISSUER || "test-issuer";
process.env.JWT_AUDIENCE = process.env.JWT_AUDIENCE || "test-audience";

const { validateCareServicePayload } = require("../routes/careServiceRoutes")._test;

test("care service validator trims names and accepts two-decimal prices", () => {
  assert.deepEqual(validateCareServicePayload({
    name: "  Daily care  ",
    description: "  Morning support ",
    amount: "125.50"
  }), {
    name: "Daily care",
    description: "Morning support",
    amount: 125.5
  });
});

test("care service validator rejects invalid prices and unsupported fields", () => {
  assert.throws(
    () => validateCareServicePayload({ name: "Care", amount: 1.005 }),
    /no more than two decimal places/
  );
  assert.throws(
    () => validateCareServicePayload({ name: "Care", amount: 10, tenantId: "other-tenant" }),
    /Unsupported field\(s\): tenantId/
  );
});

test("care service updates accept only explicitly allowed partial fields", () => {
  assert.deepEqual(validateCareServicePayload({ active: false }, true), { active: false });
  assert.deepEqual(validateCareServicePayload({}, true), {});
});

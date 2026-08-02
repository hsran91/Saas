const test = require("node:test");
const assert = require("node:assert/strict");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.JWT_ISSUER = process.env.JWT_ISSUER || "test-issuer";
process.env.JWT_AUDIENCE = process.env.JWT_AUDIENCE || "test-audience";

const invoiceRoutes = require("../routes/invoiceRoutes");

const { validateAndNormalizeInvoiceCreatePayload } = invoiceRoutes._test;

const validResidentId = "507f191e810c19729de860ea";

test("Invoice validator normalizes valid unpaid invoice payload", () => {
  const payload = validateAndNormalizeInvoiceCreatePayload({
    residentId: validResidentId,
    description: " Monthly services ",
    amount: "123.45",
    notes: "  Test note  "
  });

  assert.equal(payload.residentId, validResidentId);
  assert.equal(payload.description, "Monthly services");
  assert.equal(payload.amount, 123.45);
  assert.equal(payload.notes, "Test note");
  assert.equal(payload.isPaidOnCreate, false);
  assert.equal(payload.paymentMethod, null);
});

test("Invoice validator enforces payment fields all-or-none", () => {
  assert.throws(
    () => validateAndNormalizeInvoiceCreatePayload({
      residentId: validResidentId,
      description: "Services",
      amount: 100,
      paymentMethod: "credit",
      payerName: "Jane"
    }),
    /paymentMethod, payerName, and paymentInfo are all required/
  );
});

test("Invoice validator rejects unsupported fields and invalid residentId", () => {
  assert.throws(
    () => validateAndNormalizeInvoiceCreatePayload({
      residentId: "bad-id",
      description: "Services",
      amount: 100
    }),
    /residentId must be a valid id/
  );

  assert.throws(
    () => validateAndNormalizeInvoiceCreatePayload({
      residentId: validResidentId,
      description: "Services",
      amount: 100,
      status: "paid"
    }),
    /Unsupported field\(s\): status/
  );
});

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.JWT_ISSUER = process.env.JWT_ISSUER || "test-issuer";
process.env.JWT_AUDIENCE = process.env.JWT_AUDIENCE || "test-audience";

const invoiceRoutes = require("../routes/invoiceRoutes");

const {
  validateAndNormalizeInvoiceCreatePayload,
  validateBalancePaymentPayload,
  calculatePaymentAllocations
} = invoiceRoutes._test;

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

test("balance payment validator accepts safe partial payment details", () => {
  const payment = validateBalancePaymentPayload({
    amount: "42.50",
    paymentMethod: "bank",
    payerName: "Jane Doe",
    lastFour: "1234"
  });

  assert.equal(payment.amountCents, 4250);
  assert.equal(payment.paymentMethod, "bank");
  assert.equal(payment.lastFour, "1234");
});

test("balance payment validator rejects raw financial credentials and invalid amounts", () => {
  assert.throws(
    () => validateBalancePaymentPayload({
      amount: 10,
      paymentMethod: "credit",
      payerName: "Jane Doe",
      lastFour: "1234",
      cardNumber: "4111111111111111"
    }),
    /Unsupported field\(s\): cardNumber/
  );

  assert.throws(
    () => validateBalancePaymentPayload({
      amount: 0.001,
      paymentMethod: "credit",
      payerName: "Jane Doe",
      lastFour: "1234"
    }),
    /amount must be greater than zero/
  );
});

test("partial balance payments allocate against the oldest outstanding charges", () => {
  const invoices = [
    { _id: "oldest", amount: 30, amountPaid: 10, status: "pending" },
    { _id: "next", amount: 50, amountPaid: 0, status: "pending" },
    { _id: "already-paid", amount: 20, amountPaid: 20, status: "paid" }
  ];

  const allocations = calculatePaymentAllocations(invoices, 5500);

  assert.deepEqual(
    allocations.map(({ invoice, allocatedCents, newPaidCents }) => ({
      invoiceId: invoice._id,
      allocatedCents,
      newPaidCents
    })),
    [
      { invoiceId: "oldest", allocatedCents: 2000, newPaidCents: 3000 },
      { invoiceId: "next", allocatedCents: 3500, newPaidCents: 3500 }
    ]
  );
});

const test = require("node:test");
const assert = require("node:assert/strict");

const { notFoundHandler, errorHandler } = require("../middleware/errorHandler");

function createRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

test("notFoundHandler forwards 404 error with route details", () => {
  const req = { method: "GET", originalUrl: "/missing" };

  let forwarded;
  notFoundHandler(req, {}, (err) => {
    forwarded = err;
  });

  assert.equal(forwarded.status, 404);
  assert.match(forwarded.message, /Route not found: GET \/missing/);
});

test("errorHandler maps cast error to 400", () => {
  process.env.NODE_ENV = "test";
  const req = { method: "GET", originalUrl: "/residents/bad-id" };
  const res = createRes();

  errorHandler(
    { name: "CastError", path: "residentId", message: "Cast failed" },
    req,
    res,
    () => {}
  );

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "Invalid value for residentId");
});

test("errorHandler hides internal error message for 500", () => {
  process.env.NODE_ENV = "production";
  const req = { method: "POST", originalUrl: "/mar" };
  const res = createRes();

  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    errorHandler(new Error("database exploded"), req, res, () => {});
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error, "Internal server error");
  assert.equal(Object.prototype.hasOwnProperty.call(res.body, "details"), false);
});

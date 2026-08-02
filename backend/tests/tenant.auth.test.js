const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.JWT_ISSUER = process.env.JWT_ISSUER || "test-issuer";
process.env.JWT_AUDIENCE = process.env.JWT_AUDIENCE || "test-audience";

const auth = require("../middleware/auth");

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

function createToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    issuer: process.env.JWT_ISSUER,
    audience: process.env.JWT_AUDIENCE,
    expiresIn: "1h"
  });
}

test("auth middleware sets req.tenantId from token", async () => {
  const tenantId = "507f191e810c19729de860ea";
  const token = createToken({ id: "u1", role: "admin", tenantId });

  const req = { headers: { authorization: `Bearer ${token}` } };
  const res = createRes();

  await new Promise((resolve) => {
    auth(req, res, resolve);
  });

  assert.equal(req.tenantId, tenantId);
  assert.equal(req.user.tenantId, tenantId);
  assert.equal(res.statusCode, 200);
});

test("auth middleware rejects token with missing tenant context", async () => {
  const token = createToken({ id: "u1", role: "admin" });

  const req = { headers: { authorization: `Bearer ${token}` } };
  const res = createRes();

  await new Promise((resolve) => {
    auth(req, res, resolve);
    resolve();
  });

  assert.equal(res.statusCode, 401);
  assert.match(res.body.error, /missing tenant context/i);
});

test("auth middleware blocks cross-tenant header mismatch", async () => {
  const tokenTenantId = "507f191e810c19729de860ea";
  const otherTenantId = "507f1f77bcf86cd799439011";
  const token = createToken({ id: "u1", role: "admin", tenantId: tokenTenantId });

  const req = {
    headers: {
      authorization: `Bearer ${token}`,
      "x-tenant-id": otherTenantId
    }
  };
  const res = createRes();

  await new Promise((resolve) => {
    auth(req, res, resolve);
    resolve();
  });

  assert.equal(res.statusCode, 403);
  assert.match(res.body.error, /cross-tenant access denied/i);
});

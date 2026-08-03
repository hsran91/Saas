const test = require("node:test");
const assert = require("node:assert/strict");

const { isPlaceholderValue, validateNonDevelopmentConfig } = require("../services/config");

test("isPlaceholderValue detects common placeholder strings", () => {
  assert.equal(isPlaceholderValue("replace_me"), true);
  assert.equal(isPlaceholderValue("replace_with_metrics_token"), true);
  assert.equal(isPlaceholderValue("https://app.example.com"), true);
  assert.equal(isPlaceholderValue("mongodb+srv://prod-user:replace_me@prod-cluster.example.mongodb.net/emar_prod"), true);
  assert.equal(isPlaceholderValue("mongodb+srv://user:secret@cluster.acme.net/emar_prod"), false);
});

test("validateNonDevelopmentConfig accepts a complete non-development configuration", () => {
  const result = validateNonDevelopmentConfig({
    NODE_ENV: "production",
    MONGODB_URI: "mongodb+srv://user:secret@cluster.acme.net/emar_prod",
    CORS_ALLOWED_ORIGINS: "https://app.acmehealth.net",
    METRICS_TOKEN: "super-secret-token",
    STORAGE_DRIVER: "s3",
    OBJECT_STORAGE_BUCKET: "emar-prod-uploads",
    OBJECT_STORAGE_REGION: "us-east-1",
    OBJECT_STORAGE_ACCESS_KEY_ID: "AKIA123",
    OBJECT_STORAGE_SECRET_ACCESS_KEY: "secret123"
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test("validateNonDevelopmentConfig rejects placeholder values", () => {
  const result = validateNonDevelopmentConfig({
    NODE_ENV: "production",
    MONGODB_URI: "mongodb+srv://prod-user:replace_me@prod-cluster.example.mongodb.net/emar_prod",
    CORS_ALLOWED_ORIGINS: "https://app.example.com",
    METRICS_TOKEN: "replace_with_metrics_token",
    STORAGE_DRIVER: "s3",
    OBJECT_STORAGE_BUCKET: "",
    OBJECT_STORAGE_REGION: "us-east-1",
    OBJECT_STORAGE_ACCESS_KEY_ID: "replace_me",
    OBJECT_STORAGE_SECRET_ACCESS_KEY: "replace_me"
  });

  assert.equal(result.valid, false);
  assert.match(result.errors.join(" | "), /MONGODB_URI/);
  assert.match(result.errors.join(" | "), /CORS_ALLOWED_ORIGINS/);
  assert.match(result.errors.join(" | "), /METRICS_TOKEN/);
  assert.match(result.errors.join(" | "), /OBJECT_STORAGE_BUCKET/);
});
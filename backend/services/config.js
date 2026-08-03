const PLACEHOLDER_PATTERNS = [
  /replace_me/i,
  /replace_with_/i,
  /example\.com/i,
  /example\.mongodb\.net/i
];

const REQUIRED_NON_DEV_VARS = [
  "CORS_ALLOWED_ORIGINS",
  "METRICS_TOKEN"
];

const REQUIRED_S3_VARS = [
  "OBJECT_STORAGE_BUCKET",
  "OBJECT_STORAGE_REGION",
  "OBJECT_STORAGE_ACCESS_KEY_ID",
  "OBJECT_STORAGE_SECRET_ACCESS_KEY"
];

function isPlaceholderValue(value) {
  if (!value) return true;
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(String(value)));
}

function validateNonDevelopmentConfig(env = process.env) {
  if ((env.NODE_ENV || "development") === "development") {
    return { valid: true, errors: [] };
  }

  const errors = [];

  REQUIRED_NON_DEV_VARS.forEach((name) => {
    if (!env[name] || isPlaceholderValue(env[name])) {
      errors.push(`${name} must be set to a non-placeholder value`);
    }
  });

  if ((env.STORAGE_DRIVER || "local").toLowerCase() === "s3") {
    REQUIRED_S3_VARS.forEach((name) => {
      if (!env[name] || isPlaceholderValue(env[name])) {
        errors.push(`${name} must be set to a non-placeholder value when STORAGE_DRIVER=s3`);
      }
    });
  }

  if (env.MONGODB_URI && isPlaceholderValue(env.MONGODB_URI)) {
    errors.push("MONGODB_URI must be set to a non-placeholder value");
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

module.exports = {
  isPlaceholderValue,
  validateNonDevelopmentConfig
};
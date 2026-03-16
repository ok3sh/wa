function validateRequiredEnv(env) {
  const required = ["TOKEN", "PHONE_NUMBER_ID"];
  const missing = required.filter((key) => !env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}

function getEnvWarnings(env) {
  const warnings = [];

  if (!env.WA_VERIFY_TOKEN) {
    warnings.push("WA_VERIFY_TOKEN is not set. Using the default token is not recommended for production.");
  }

  if (!env.APP_SECRET) {
    warnings.push("APP_SECRET is not set. Webhook signature verification is disabled.");
  }

  return warnings;
}

module.exports = {
  validateRequiredEnv,
  getEnvWarnings,
};

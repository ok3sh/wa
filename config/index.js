const path = require("path");
const { warn } = require("../utils/logger");
const { validateRequiredEnv, getEnvWarnings } = require("../validators/envValidator");

const env = (name) => process.env[name]?.trim();

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = env("WA_VERIFY_TOKEN") || "finfinity_verify_token";
const TOKEN = env("TOKEN");
const PHONE_NUMBER_ID = env("PHONE_NUMBER_ID");
const APP_SECRET = env("APP_SECRET");

const LEAD_STORAGE = String(env("LEAD_STORAGE") || "csv").toLowerCase();
const POSTGRES_HOST = env("POSTGRES_HOST") || env("DB_HOST") || env("PGHOST");
const POSTGRES_PORT = Number(env("POSTGRES_PORT") || env("DB_PORT") || env("PGPORT") || 5432);
const POSTGRES_DB = env("POSTGRES_DB") || env("DB_NAME") || env("PGDATABASE");
const POSTGRES_USER = env("POSTGRES_USER") || env("DB_USER") || env("PGUSER");
const POSTGRES_PASSWORD = env("POSTGRES_PASSWORD") || env("DB_PASSWORD") || env("PGPASSWORD");
const POSTGRES_SSL = String(env("POSTGRES_SSL") || "false").toLowerCase() === "true";
const POSTGRES_POOL_MAX = Number(env("POSTGRES_POOL_MAX") || 10);

const TESTER_ACCESS_ENABLED =
  String(process.env.TESTER_ACCESS_ENABLED || "false").toLowerCase() === "true";
const TESTER_ALLOWED_PHONES = new Set(
  String(process.env.TESTER_ALLOWED_PHONES || "")
    .split(",")
    .map((v) => v.trim().replace(/\D/g, ""))
    .filter(Boolean)
);

const WEBVIEW_LINK = env("WEBVIEW_LINK") || "https://frm.finfinity.co.in/?utm_campaign=RITEN";
const IMAGE_URL = env("IMAGE_URL");

const CSV_FILE = path.join(process.cwd(), "leads.csv");
const LOGO_FILE = path.join(process.cwd(), "fin_logo.jpg");

const PRODUCT_MAP = {
  HL: "Home Loan",
  PL: "Personal Loan",
  LAP: "Loan Against Property",
  INVESTMENTS: "Investments",
};

function validateEnv() {
  try {
    validateRequiredEnv({ TOKEN, PHONE_NUMBER_ID });
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  const warnings = getEnvWarnings({
    WA_VERIFY_TOKEN: env("WA_VERIFY_TOKEN"),
    APP_SECRET,
  });

  if (TESTER_ACCESS_ENABLED && !TESTER_ALLOWED_PHONES.size) {
    warnings.push(
      "TESTER_ACCESS_ENABLED is true but TESTER_ALLOWED_PHONES is empty; all users will be blocked."
    );
  }

  if (LEAD_STORAGE === "postgres") {
    const hasPostgresConfig = Boolean(
      POSTGRES_HOST && POSTGRES_DB && POSTGRES_USER && POSTGRES_PASSWORD
    );
    if (!hasPostgresConfig) {
      warnings.push(
        "LEAD_STORAGE is postgres but Postgres credentials are incomplete; app will fall back to CSV."
      );
    }
  }

  for (const message of warnings) {
    warn(message);
  }
}

module.exports = {
  PORT,
  VERIFY_TOKEN,
  TOKEN,
  PHONE_NUMBER_ID,
  APP_SECRET,
  LEAD_STORAGE,
  POSTGRES_HOST,
  POSTGRES_PORT,
  POSTGRES_DB,
  POSTGRES_USER,
  POSTGRES_PASSWORD,
  POSTGRES_SSL,
  POSTGRES_POOL_MAX,
  TESTER_ACCESS_ENABLED,
  TESTER_ALLOWED_PHONES,
  WEBVIEW_LINK,
  IMAGE_URL,
  CSV_FILE,
  LOGO_FILE,
  PRODUCT_MAP,
  validateEnv,
};

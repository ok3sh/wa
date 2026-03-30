const path = require("path");
const { warn } = require("../utils/logger");
const { validateRequiredEnv, getEnvWarnings } = require("../validators/envValidator");

const env = (name) => process.env[name]?.trim();

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = env("WA_VERIFY_TOKEN") || "finfinity_verify_token";
const TOKEN = env("TOKEN");
const PHONE_NUMBER_ID = env("PHONE_NUMBER_ID");
const APP_SECRET = env("APP_SECRET");

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
  WEBVIEW_LINK,
  IMAGE_URL,
  CSV_FILE,
  LOGO_FILE,
  PRODUCT_MAP,
  validateEnv,
};

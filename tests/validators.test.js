const test = require("node:test");
const assert = require("node:assert/strict");

const { validateRequiredEnv, getEnvWarnings } = require("../validators/envValidator");
const { extractWebhookMessage } = require("../validators/webhookValidator");

test("validateRequiredEnv accepts required keys", () => {
  assert.doesNotThrow(() => {
    validateRequiredEnv({ TOKEN: "abc", PHONE_NUMBER_ID: "123" });
  });
});

test("validateRequiredEnv throws when required keys are missing", () => {
  assert.throws(
    () => validateRequiredEnv({ TOKEN: "abc" }),
    /Missing required environment variables/
  );
});

test("getEnvWarnings includes WA_VERIFY_TOKEN and APP_SECRET warnings when absent", () => {
  const warnings = getEnvWarnings({});
  assert.equal(warnings.length, 2);
});

test("extractWebhookMessage returns null for invalid payload", () => {
  assert.equal(extractWebhookMessage({}), null);
});

test("extractWebhookMessage returns parsed value for valid payload", () => {
  const payload = {
    entry: [
      {
        changes: [
          {
            value: {
              contacts: [{ wa_id: "12345" }],
              messages: [{ id: "m1", from: "91999", type: "text", text: { body: "hi" } }],
            },
          },
        ],
      },
    ],
  };

  const extracted = extractWebhookMessage(payload);
  assert.ok(extracted);
  assert.equal(extracted.message.id, "m1");
  assert.equal(extracted.message.from, "91999");
});

const test = require("node:test");
const assert = require("node:assert/strict");

const { validateRequiredEnv, getEnvWarnings } = require("../validators/envValidator");
const { extractWebhookMessages } = require("../validators/webhookValidator");

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

test("extractWebhookMessages returns empty array for invalid payload", () => {
  assert.deepEqual(extractWebhookMessages({}), []);
});

test("extractWebhookMessages returns parsed entries for a valid payload", () => {
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

  const results = extractWebhookMessages(payload);
  assert.equal(results.length, 1);
  assert.equal(results[0].message.id, "m1");
  assert.equal(results[0].message.from, "91999");
});

test("extractWebhookMessages returns all messages from a batched payload", () => {
  const makeEntry = (id, from) => ({
    changes: [
      {
        value: {
          messages: [{ id, from, type: "text", text: { body: "hey" } }],
        },
      },
    ],
  });

  const payload = { entry: [makeEntry("m1", "111"), makeEntry("m2", "222")] };
  const results = extractWebhookMessages(payload);
  assert.equal(results.length, 2);
  assert.equal(results[0].message.id, "m1");
  assert.equal(results[1].message.id, "m2");
});

/**
 * Extracts every message from a Meta webhook payload.
 * Meta CAN batch multiple entries and multiple messages per change, so
 * returning only entry[0]/messages[0] silently drops the rest.
 *
 * @returns {{ value: object, message: object }[]}
 */
function extractWebhookMessages(body) {
  const results = [];

  for (const entry of body?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value;
      for (const message of value?.messages ?? []) {
        if (message?.from) {
          results.push({ value, message });
        }
      }
    }
  }

  return results;
}

module.exports = {
  extractWebhookMessages,
};

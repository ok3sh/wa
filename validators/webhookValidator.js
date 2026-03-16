function extractWebhookMessage(body) {
  const entry = body?.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;
  const message = value?.messages?.[0];

  if (!message || !message.from) {
    return null;
  }

  return {
    value,
    message,
  };
}

module.exports = {
  extractWebhookMessage,
};

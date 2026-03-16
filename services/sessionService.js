const seenMessages = new Map();
const userSessions = new Map();

const DEDUP_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 30 * 60 * 1000;

function startCleanupJobs() {
  setInterval(() => {
    const cutoff = Date.now() - DEDUP_TTL_MS;
    for (const [id, ts] of seenMessages) {
      if (ts < cutoff) seenMessages.delete(id);
    }
  }, DEDUP_TTL_MS).unref();

  setInterval(() => {
    const cutoff = Date.now() - SESSION_TTL_MS;
    for (const [phone, session] of userSessions) {
      if (!session || !session.ts || session.ts < cutoff) {
        userSessions.delete(phone);
      }
    }
  }, SESSION_TTL_MS).unref();
}

function isDuplicateMessage(messageId) {
  if (!messageId) return false;
  return seenMessages.has(messageId);
}

function markMessageSeen(messageId) {
  if (!messageId) return;
  seenMessages.set(messageId, Date.now());
}

function getSession(phone) {
  return userSessions.get(phone);
}

function setAwaitingGrievance(phone) {
  userSessions.set(phone, { state: "AWAITING_GRIEVANCE", ts: Date.now() });
}

function clearSession(phone) {
  userSessions.delete(phone);
}

module.exports = {
  startCleanupJobs,
  isDuplicateMessage,
  markMessageSeen,
  getSession,
  setAwaitingGrievance,
  clearSession,
};

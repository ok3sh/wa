const seenMessages = new Map();
const userSessions = new Map();

const DEDUP_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 30 * 60 * 1000;

// How long after the user's LAST message we wait before sending the summary email.
// Resets on every new message so the email only fires once they've gone quiet.
// Terminal flows (product selected, grievance submitted etc.) bypass this via flushNow().
const SESSION_EMAIL_DELAY_MS = Number(process.env.SESSION_EMAIL_DELAY_MS || 60 * 1000); // 1 minute

let _onFlush = null;

// Register the callback that fires when a user session is ready to be emailed.
// Called once at startup from webhookRoutes.js.
function registerFlushCallback(cb) {
  _onFlush = cb;
}

function _flush(phone, session) {
  userSessions.delete(phone);
  if (_onFlush && session?.steps?.length > 0) {
    _onFlush(phone, session).catch(() => {});
  }
}

function _scheduleFlush(phone) {
  const session = userSessions.get(phone);
  if (!session) return;

  if (session._timer) clearTimeout(session._timer);

  const timer = setTimeout(() => _flush(phone, session), SESSION_EMAIL_DELAY_MS);
  // Don't keep the process alive just for email timers.
  if (timer.unref) timer.unref();
  session._timer = timer;
}

function _getOrCreate(phone) {
  if (!userSessions.has(phone)) {
    userSessions.set(phone, { state: null, ts: Date.now(), steps: [], _timer: null });
  }
  return userSessions.get(phone);
}

// Add one interaction step to the user's running session and reset the flush timer.
function addFlowStep(phone, { contactName, waId, flow, selectionId, selectionLabel, userMessage }) {
  const session = _getOrCreate(phone);

  // Keep the first real contactName we see — that's the most reliable.
  if (contactName && !session.contactName) session.contactName = contactName;
  if (waId) session.waId = waId;

  session.steps.push({
    ts: new Date().toISOString(),
    flow,
    selectionId: selectionId || null,
    selectionLabel: selectionLabel || null,
    userMessage: userMessage || null,
  });

  session.ts = Date.now();
  _scheduleFlush(phone);
}

function startCleanupJobs() {
  // Purge old dedup entries.
  setInterval(() => {
    const cutoff = Date.now() - DEDUP_TTL_MS;
    for (const [id, ts] of seenMessages) {
      if (ts < cutoff) seenMessages.delete(id);
    }
  }, DEDUP_TTL_MS).unref();

  // Safety net: force-flush sessions that somehow outlived SESSION_TTL_MS
  // (e.g. the per-session timer never fired). Normally the debounce handles this.
  setInterval(() => {
    const cutoff = Date.now() - SESSION_TTL_MS;
    for (const [phone, session] of userSessions) {
      if (!session?.ts || session.ts < cutoff) {
        if (session?._timer) clearTimeout(session._timer);
        _flush(phone, session);
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
  const session = _getOrCreate(phone);
  session.state = "AWAITING_GRIEVANCE";
  session.ts = Date.now();
}

// Clear the conversational state (e.g. after grievance submitted) but do NOT
// cancel the flush timer — the accumulated steps still need to be emailed.
function clearSession(phone) {
  const session = userSessions.get(phone);
  if (session) {
    session.state = null;
    session.ts = Date.now();
  }
}

// Immediately send the session email without waiting for the debounce timer.
// Use this after terminal flow steps (product selected, grievance submitted, etc.)
// so the email fires right away instead of after the idle timeout.
function flushNow(phone) {
  const session = userSessions.get(phone);
  if (!session) return;
  if (session._timer) clearTimeout(session._timer);
  _flush(phone, session);
}

module.exports = {
  startCleanupJobs,
  registerFlushCallback,
  addFlowStep,
  flushNow,
  isDuplicateMessage,
  markMessageSeen,
  getSession,
  setAwaitingGrievance,
  clearSession,
};

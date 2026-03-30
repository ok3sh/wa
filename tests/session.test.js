const test = require("node:test");
const assert = require("node:assert/strict");

// Import fresh module state for each run. Because the Maps are module-level
// singletons, running this file in isolation gives us a clean slate.
const {
  isDuplicateMessage,
  markMessageSeen,
  getSession,
  setAwaitingGrievance,
  clearSession,
} = require("../services/sessionService");

// ── Deduplication ─────────────────────────────────────────────────────────

test("isDuplicateMessage returns false for an unseen message ID", () => {
  assert.equal(isDuplicateMessage("msg-new-1"), false);
});

test("isDuplicateMessage returns false when messageId is falsy", () => {
  assert.equal(isDuplicateMessage(null), false);
  assert.equal(isDuplicateMessage(""), false);
  assert.equal(isDuplicateMessage(undefined), false);
});

test("markMessageSeen + isDuplicateMessage detects a seen ID", () => {
  markMessageSeen("msg-abc");
  assert.equal(isDuplicateMessage("msg-abc"), true);
});

test("markMessageSeen ignores falsy IDs", () => {
  assert.doesNotThrow(() => markMessageSeen(null));
  assert.doesNotThrow(() => markMessageSeen(""));
});

test("different message IDs are independent", () => {
  markMessageSeen("msg-x");
  assert.equal(isDuplicateMessage("msg-x"), true);
  assert.equal(isDuplicateMessage("msg-y"), false);
});

// ── Session state ─────────────────────────────────────────────────────────

test("getSession returns undefined for an unknown phone", () => {
  assert.equal(getSession("+9199900000"), undefined);
});

test("setAwaitingGrievance creates an AWAITING_GRIEVANCE session", () => {
  setAwaitingGrievance("+9199900001");
  const session = getSession("+9199900001");
  assert.ok(session);
  assert.equal(session.state, "AWAITING_GRIEVANCE");
  assert.ok(typeof session.ts === "number");
});

test("clearSession clears the state but keeps the session alive for email flush", () => {
  setAwaitingGrievance("+9199900002");
  clearSession("+9199900002");
  // Session must still exist so the debounce timer can fire and send the email.
  const session = getSession("+9199900002");
  assert.ok(session, "session should still exist after clearSession");
  assert.equal(session.state, null);
});

test("clearSession on an unknown phone is a no-op", () => {
  assert.doesNotThrow(() => clearSession("+9199900099"));
});

test("sessions for different phones are independent", () => {
  setAwaitingGrievance("+9199900003");
  assert.equal(getSession("+9199900003")?.state, "AWAITING_GRIEVANCE");
  assert.equal(getSession("+9199900004"), undefined);
});

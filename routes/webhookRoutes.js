const express = require("express");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");

const {
  VERIFY_TOKEN,
  PRODUCT_MAP,
  APP_SECRET,
  TESTER_ACCESS_ENABLED,
  TESTER_ALLOWED_PHONES,
} = require("../config");
const { logLead } = require("../services/leadService");
const { notifySessionEmail } = require("../services/emailService");
const {
  isDuplicateMessage,
  markMessageSeen,
  getSession,
  setAwaitingGrievance,
  clearSession,
  addFlowStep,
  flushNow,
  registerFlushCallback,
} = require("../services/sessionService");
const {
  sendMainMenu,
  sendLoanSubMenu,
  sendPartnerSubMenu,
  sendContactSubMenu,
  sendThankYouGeneric,
  sendFAQs,
  sendWebviewLink,
} = require("../services/whatsappService");
const { extractWebhookMessages } = require("../validators/webhookValidator");
const logger = require("../utils/logger");

const router = express.Router();

// When a user's session goes quiet, fire one summary email with everything they did.
registerFlushCallback(async (phone, session) => {
  await notifySessionEmail({
    phone,
    waId: session.waId,
    contactName: session.contactName,
    steps: session.steps,
  });
});

// Limit inbound webhook requests to guard against DDoS / runaway replays.
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.WEBHOOK_RATE_LIMIT || 120),
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Too many requests" },
});

// Module-level constants — avoids re-creating the same objects on every request.
const PARTNER_LABEL = {
  PARTNER_CORP: "Corporate Partnership",
  PARTNER_DEV: "Developer Partner",
  PARTNER_AFFILIATE: "Affiliate Partner",
  PARTNER_DIGITAL: "Digital Partner",
};

const PARTNER_IDS = Object.keys(PARTNER_LABEL);

function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "");
}

function isTesterAllowed(phone) {
  if (!TESTER_ACCESS_ENABLED) return true;
  return TESTER_ALLOWED_PHONES.has(normalizePhone(phone));
}

// Verify webhook origin when APP_SECRET is configured; stays permissive for legacy setups.
function verifyMetaSignature(req) {
  if (!APP_SECRET) return true;

  const signature = req.get("x-hub-signature-256");
  if (!signature || !req.rawBody) return false;

  const expected = `sha256=${crypto
    .createHmac("sha256", APP_SECRET)
    .update(req.rawBody)
    .digest("hex")}`;

  const actualBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);

  if (actualBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(actualBuf, expectedBuf);
}

router.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

router.post("/webhook", webhookLimiter, async (req, res) => {
  if (!verifyMetaSignature(req)) {
    logger.warn("Rejected webhook due to invalid signature", {
      requestId: req.requestId,
    });
    return res.sendStatus(403);
  }

  // ACK immediately so Meta does not retry on slow downstream operations.
  res.sendStatus(200);

  // Meta CAN batch multiple entries/messages in one payload — process them all.
  const payloads = extractWebhookMessages(req.body);
  if (!payloads.length) return;

  for (const { value, message } of payloads) {
    try {
      await processMessage({ value, message, requestId: req.requestId });
    } catch (err) {
      logger.error("webhook_message_processing_error", {
        requestId: req.requestId,
        messageId: message?.id,
        error: err.response?.data || err.message,
      });
    }
  }
});

async function processMessage({ value, message, requestId }) {
  const from = message.from;
  const wa_id = value?.contacts?.[0]?.wa_id || from;
  const contactName = value?.contacts?.[0]?.profile?.name || "";
  const messageId = message.id;

  if (!isTesterAllowed(from)) {
    logger.info("tester_access_blocked", {
      requestId,
      phone: from,
      messageId,
    });
    return;
  }

  // Ignore already-seen message IDs to prevent duplicate user responses.
  if (isDuplicateMessage(messageId)) {
    logger.info("duplicate_webhook_ignored", { requestId, messageId });
    return;
  }
  markMessageSeen(messageId);

  // Shared context passed into every addFlowStep call.
  const ctx = { contactName, waId: wa_id };

  if (message.type === "text") {
    const text = message.text?.body?.trim() || "";
    const textLower = text.toLowerCase();
    const session = getSession(from);

    if (session?.state === "AWAITING_GRIEVANCE") {
      clearSession(from);

      logLead({ phone: from, wa_id, product: "GRIEVANCE_SUBMITTED", productLabel: "Grievance Submitted", messageId });
      addFlowStep(from, { ...ctx, flow: "Grievance Submitted", userMessage: text });
      flushNow(from); // terminal — send email immediately

      await sendThankYouGeneric(
        from,
        "Thank you for raising your grievance.\n\nWe've noted your concern and our team will get back to you within 24-48 hours. We're here to help."
      );
      return;
    }

    // Any regular text returns the user to the top-level menu.
    const isGreeting = textLower === "hi" || textLower === "hello";
    const flow = isGreeting ? "Greeting / Main Menu" : "Free Text / Main Menu";

    logLead({ phone: from, wa_id, product: isGreeting ? "MAIN_MENU_GREETING" : "MAIN_MENU_TEXT", productLabel: flow, messageId });
    addFlowStep(from, { ...ctx, flow, userMessage: text });

    await sendMainMenu(from, isGreeting);
    return;
  }

  // Interactive payloads are button/list replies from WhatsApp.
  if (message.type !== "interactive") return;

  const buttonId =
    message.interactive?.button_reply?.id ||
    message.interactive?.list_reply?.id;

  if (!buttonId) return;

  if (buttonId === "MAIN_LOANS") {
    logLead({ phone: from, wa_id, product: "MAIN_LOANS", productLabel: "Apply for a Loan - Menu Opened", messageId });
    addFlowStep(from, { ...ctx, flow: "Apply for a Loan - Menu Opened", selectionId: buttonId, selectionLabel: "Apply for a Loan" });
    await sendLoanSubMenu(from);
    return;
  }

  if (buttonId === "MAIN_PARTNER") {
    logLead({ phone: from, wa_id, product: "MAIN_PARTNER", productLabel: "Partner with Us - Menu Opened", messageId });
    addFlowStep(from, { ...ctx, flow: "Partner with Us - Menu Opened", selectionId: buttonId, selectionLabel: "Partner with Us" });
    await sendPartnerSubMenu(from);
    return;
  }

  if (buttonId === "MAIN_CONTACT") {
    logLead({ phone: from, wa_id, product: "MAIN_CONTACT", productLabel: "Contact Us - Menu Opened", messageId });
    addFlowStep(from, { ...ctx, flow: "Contact Us - Menu Opened", selectionId: buttonId, selectionLabel: "Contact Us" });
    await sendContactSubMenu(from);
    return;
  }

  if (PRODUCT_MAP[buttonId]) {
    logLead({ phone: from, wa_id, product: buttonId, productLabel: PRODUCT_MAP[buttonId], messageId });
    addFlowStep(from, { ...ctx, flow: "Apply for a Loan - Product Selected", selectionId: buttonId, selectionLabel: PRODUCT_MAP[buttonId] });
    flushNow(from); // terminal — user reached a product, send email immediately
    await sendWebviewLink(from, PRODUCT_MAP[buttonId], buttonId);
    return;
  }

  if (PARTNER_IDS.includes(buttonId)) {
    logLead({ phone: from, wa_id, product: buttonId, productLabel: PARTNER_LABEL[buttonId], messageId });
    addFlowStep(from, { ...ctx, flow: "Partner with Us - Selection", selectionId: buttonId, selectionLabel: PARTNER_LABEL[buttonId] });
    flushNow(from); // terminal — partner type selected, send email immediately
    await sendThankYouGeneric(
      from,
      "Thank you for your interest in partnering with Finfinity.\n\nOur partnerships team will review your request and get back to you within 2-3 business days."
    );
    return;
  }

  if (buttonId === "CONTACT_RM") {
    logLead({ phone: from, wa_id, product: "CONTACT_RM", productLabel: "Speak to an RM", messageId });
    addFlowStep(from, { ...ctx, flow: "Contact Us - Speak to RM", selectionId: buttonId, selectionLabel: "Speak to an RM" });
    flushNow(from); // terminal — RM requested, send email immediately
    await sendThankYouGeneric(
      from,
      "Thank you for reaching out.\n\nYour request has been noted. A Relationship Manager from Finfinity will get in touch with you shortly."
    );
    return;
  }

  if (buttonId === "CONTACT_FAQ") {
    logLead({ phone: from, wa_id, product: "CONTACT_FAQ", productLabel: "Read FAQs", messageId });
    addFlowStep(from, { ...ctx, flow: "Contact Us - FAQs", selectionId: buttonId, selectionLabel: "Read FAQs" });
    await sendFAQs(from);
    return;
  }

  if (buttonId === "CONTACT_GRIEVANCE") {
    logLead({ phone: from, wa_id, product: "CONTACT_GRIEVANCE", productLabel: "Grievance Started", messageId });
    addFlowStep(from, { ...ctx, flow: "Contact Us - Grievance Started", selectionId: buttonId, selectionLabel: "Raise a Grievance" });
    setAwaitingGrievance(from);
    await sendThankYouGeneric(
      from,
      "Please type your grievance below and we'll make sure it reaches the right team."
    );
    return;
  }

  if (buttonId === "BACK_MENU") {
    logLead({ phone: from, wa_id, product: "BACK_MENU", productLabel: "Back to Main Menu", messageId });
    addFlowStep(from, { ...ctx, flow: "Back to Main Menu", selectionId: buttonId, selectionLabel: "Back" });
    await sendMainMenu(from, false);
  }
}

module.exports = router;

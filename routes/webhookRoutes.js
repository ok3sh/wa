const express = require("express");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");

const { VERIFY_TOKEN, PRODUCT_MAP, APP_SECRET } = require("../config");
const { logLead } = require("../services/leadService");
const { notifyNewEntryEmail } = require("../services/emailService");
const {
  isDuplicateMessage,
  markMessageSeen,
  getSession,
  setAwaitingGrievance,
  clearSession,
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

// Limit inbound webhook requests to guard against DDoS / runaway replays.
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.WEBHOOK_RATE_LIMIT || 120),
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Too many requests" },
});

// Module-level constant — avoids re-creating the same object on every request.
const PARTNER_LABEL = {
  PARTNER_CORP: "Corporate Partnership",
  PARTNER_DEV: "Developer Partner",
  PARTNER_AFFILIATE: "Affiliate Partner",
  PARTNER_DIGITAL: "Digital Partner",
};

const PARTNER_IDS = Object.keys(PARTNER_LABEL);

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

  // Ignore already-seen message IDs to prevent duplicate user responses.
  if (isDuplicateMessage(messageId)) {
    logger.info("duplicate_webhook_ignored", { requestId, messageId });
    return;
  }
  markMessageSeen(messageId);

  if (message.type === "text") {
    const text = message.text?.body?.trim() || "";
    const textLower = text.toLowerCase();
    const session = getSession(from);

    if (session?.state === "AWAITING_GRIEVANCE") {
      clearSession(from);
      await sendThankYouGeneric(
        from,
        "Thank you for raising your grievance.\n\nWe've noted your concern and our team will get back to you within 24-48 hours. We're here to help."
      );

      await notifyNewEntryEmail({
        phone: from,
        waId: wa_id,
        contactName,
        messageId,
        flow: "Grievance Submitted",
        userMessage: text,
      });
      return;
    }

    // Any regular text returns the user to the top-level menu.
    const isGreeting = textLower === "hi" || textLower === "hello";
    await sendMainMenu(from, isGreeting);

    await notifyNewEntryEmail({
      phone: from,
      waId: wa_id,
      contactName,
      messageId,
      flow: isGreeting ? "Greeting / Main Menu" : "Free Text / Main Menu",
      userMessage: text,
    });
    return;
  }

  // Interactive payloads are button/list replies from WhatsApp.
  if (message.type !== "interactive") return;

  const buttonId =
    message.interactive?.button_reply?.id ||
    message.interactive?.list_reply?.id;

  if (!buttonId) return;

  if (buttonId === "MAIN_LOANS") {
    await sendLoanSubMenu(from);
    await notifyNewEntryEmail({
      phone: from,
      waId: wa_id,
      contactName,
      messageId,
      flow: "Apply for a Loan - Menu Opened",
      selectionId: buttonId,
      selectionLabel: "Apply for a Loan",
    });
    return;
  }

  if (buttonId === "MAIN_PARTNER") {
    await sendPartnerSubMenu(from);
    await notifyNewEntryEmail({
      phone: from,
      waId: wa_id,
      contactName,
      messageId,
      flow: "Partner with Us - Menu Opened",
      selectionId: buttonId,
      selectionLabel: "Partner with Us",
    });
    return;
  }

  if (buttonId === "MAIN_CONTACT") {
    await sendContactSubMenu(from);
    await notifyNewEntryEmail({
      phone: from,
      waId: wa_id,
      contactName,
      messageId,
      flow: "Contact Us - Menu Opened",
      selectionId: buttonId,
      selectionLabel: "Contact Us",
    });
    return;
  }

  if (PRODUCT_MAP[buttonId]) {
    logLead({
      phone: from,
      wa_id,
      product: buttonId,
      productLabel: PRODUCT_MAP[buttonId],
      messageId,
    });

    await sendWebviewLink(from, PRODUCT_MAP[buttonId], buttonId);
    await notifyNewEntryEmail({
      phone: from,
      waId: wa_id,
      contactName,
      messageId,
      flow: "Apply for a Loan - Product Selected",
      selectionId: buttonId,
      selectionLabel: PRODUCT_MAP[buttonId],
    });
    return;
  }

  if (PARTNER_IDS.includes(buttonId)) {
    await sendThankYouGeneric(
      from,
      "Thank you for your interest in partnering with Finfinity.\n\nOur partnerships team will review your request and get back to you within 2-3 business days."
    );

    await notifyNewEntryEmail({
      phone: from,
      waId: wa_id,
      contactName,
      messageId,
      flow: "Partner with Us - Selection",
      selectionId: buttonId,
      selectionLabel: PARTNER_LABEL[buttonId],
    });
    return;
  }

  if (buttonId === "CONTACT_RM") {
    await sendThankYouGeneric(
      from,
      "Thank you for reaching out.\n\nYour request has been noted. A Relationship Manager from Finfinity will get in touch with you shortly."
    );

    await notifyNewEntryEmail({
      phone: from,
      waId: wa_id,
      contactName,
      messageId,
      flow: "Contact Us - Speak to RM",
      selectionId: buttonId,
      selectionLabel: "Speak to an RM",
    });
    return;
  }

  if (buttonId === "CONTACT_FAQ") {
    await sendFAQs(from);
    await notifyNewEntryEmail({
      phone: from,
      waId: wa_id,
      contactName,
      messageId,
      flow: "Contact Us - FAQs",
      selectionId: buttonId,
      selectionLabel: "Read FAQs",
    });
    return;
  }

  if (buttonId === "CONTACT_GRIEVANCE") {
    setAwaitingGrievance(from);
    await sendThankYouGeneric(
      from,
      "Please type your grievance below and we'll make sure it reaches the right team."
    );

    await notifyNewEntryEmail({
      phone: from,
      waId: wa_id,
      contactName,
      messageId,
      flow: "Contact Us - Grievance Started",
      selectionId: buttonId,
      selectionLabel: "Raise a Grievance",
    });
    return;
  }

  if (buttonId === "BACK_MENU") {
    await sendMainMenu(from, false);
    await notifyNewEntryEmail({
      phone: from,
      waId: wa_id,
      contactName,
      messageId,
      flow: "Back to Main Menu",
      selectionId: buttonId,
      selectionLabel: "Back",
    });
  }
}

module.exports = router;

const express = require("express");
const crypto = require("crypto");

const { VERIFY_TOKEN, /* PRODUCT_MAP, */ APP_SECRET } = require("../config"); // PRODUCT_MAP TEMPORARILY DISABLED
const { logLead } = require("../services/leadService");
const {
  isDuplicateMessage,
  markMessageSeen,
  getSession,
  setAwaitingGrievance,
  clearSession,
} = require("../services/sessionService");
const {
  sendMainMenu,
  // sendLoanSubMenu,    // TEMPORARILY DISABLED
  sendPartnerSubMenu,
  sendContactSubMenu,
  sendThankYouGeneric,
  sendFAQs,
  // sendWebviewLink,    // TEMPORARILY DISABLED
} = require("../services/whatsappService");
const { extractWebhookMessage } = require("../validators/webhookValidator");
const logger = require("../utils/logger");

const router = express.Router();

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

router.post("/webhook", async (req, res) => {
  if (!verifyMetaSignature(req)) {
    logger.warn("Rejected webhook due to invalid signature", {
      requestId: req.requestId,
    });
    return res.sendStatus(403);
  }

  // ACK immediately so Meta does not retry on slow downstream operations.
  res.sendStatus(200);

  try {
    const payload = extractWebhookMessage(req.body);
    if (!payload) return;

    const { value, message } = payload;

    const from = message.from;
    const wa_id = value?.contacts?.[0]?.wa_id || from;
    const messageId = message.id;

    // Ignore already-seen message IDs to prevent duplicate user responses.
    if (isDuplicateMessage(messageId)) {
      logger.info("duplicate_webhook_ignored", {
        requestId: req.requestId,
        messageId,
      });
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
        return;
      }

      // Any regular text returns the user to the top-level menu.
      const isGreeting = textLower === "hi" || textLower === "hello";
      await sendMainMenu(from, isGreeting);
      return;
    }

    // Interactive payloads are button/list replies from WhatsApp.
    if (message.type !== "interactive") return;

    const buttonId =
      message.interactive?.button_reply?.id ||
      message.interactive?.list_reply?.id;

    if (!buttonId) return;

    // TEMPORARILY DISABLED — Apply for a Loan flow
    // if (buttonId === "MAIN_LOANS") {
    //   await sendLoanSubMenu(from);
    //   return;
    // }

    if (buttonId === "MAIN_PARTNER") {
      await sendPartnerSubMenu(from);
      return;
    }

    if (buttonId === "MAIN_CONTACT") {
      await sendContactSubMenu(from);
      return;
    }

    // TEMPORARILY DISABLED — Loan product selection and webview link
    // if (PRODUCT_MAP[buttonId]) {
    //   logLead({
    //     phone: from,
    //     wa_id,
    //     product: buttonId,
    //     productLabel: PRODUCT_MAP[buttonId],
    //     messageId,
    //   });
    //
    //   await sendWebviewLink(from, PRODUCT_MAP[buttonId], buttonId);
    //   return;
    // }

    const partnerIds = ["PARTNER_CORP", "PARTNER_DEV", "PARTNER_AFFILIATE", "PARTNER_DIGITAL"];
    if (partnerIds.includes(buttonId)) {
      await sendThankYouGeneric(
        from,
        "Thank you for your interest in partnering with Finfinity.\n\nOur partnerships team will review your request and get back to you within 2-3 business days."
      );
      return;
    }

    if (buttonId === "CONTACT_RM") {
      await sendThankYouGeneric(
        from,
        "Thank you for reaching out.\n\nYour request has been noted. A Relationship Manager from Finfinity will get in touch with you shortly."
      );
      return;
    }

    if (buttonId === "CONTACT_FAQ") {
      await sendFAQs(from);
      return;
    }

    if (buttonId === "CONTACT_GRIEVANCE") {
      setAwaitingGrievance(from);
      await sendThankYouGeneric(
        from,
        "Please type your grievance below and we'll make sure it reaches the right team."
      );
      return;
    }

    if (buttonId === "BACK_MENU") {
      await sendMainMenu(from, false);
    }
  } catch (err) {
    logger.error("Webhook error", {
      requestId: req.requestId,
      error: err.response?.data || err.message,
    });
  }
});

module.exports = router;

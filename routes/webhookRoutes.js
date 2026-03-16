const express = require("express");

const { VERIFY_TOKEN, PRODUCT_MAP } = require("../config");
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
  sendLoanSubMenu,
  sendPartnerSubMenu,
  sendContactSubMenu,
  sendThankYouGeneric,
  sendFAQs,
  sendWebviewLink,
} = require("../services/whatsappService");

const router = express.Router();

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
  res.sendStatus(200);

  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    if (!message) return;

    const from = message.from;
    const wa_id = value?.contacts?.[0]?.wa_id || from;
    const messageId = message.id;

    if (isDuplicateMessage(messageId)) {
      console.log("Duplicate webhook ignored:", messageId);
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

      const isGreeting = textLower === "hi" || textLower === "hello";
      await sendMainMenu(from, isGreeting);
      return;
    }

    if (message.type !== "interactive") return;

    const buttonId =
      message.interactive?.button_reply?.id ||
      message.interactive?.list_reply?.id;

    if (!buttonId) return;

    if (buttonId === "MAIN_LOANS") {
      await sendLoanSubMenu(from);
      return;
    }

    if (buttonId === "MAIN_PARTNER") {
      await sendPartnerSubMenu(from);
      return;
    }

    if (buttonId === "MAIN_CONTACT") {
      await sendContactSubMenu(from);
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
      return;
    }

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
    console.error("Webhook error:", err.response?.data || err.message);
  }
});

module.exports = router;

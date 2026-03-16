const axios = require("axios");

const {
  TOKEN,
  PHONE_NUMBER_ID,
  WEBVIEW_LINK,
  IMAGE_URL,
} = require("../config");
const logger = require("../utils/logger");

const WA_TIMEOUT_MS = Number(process.env.WA_TIMEOUT_MS || 10000);
const WA_RETRY_COUNT = Number(process.env.WA_RETRY_COUNT || 2);
const WA_RETRY_BASE_MS = Number(process.env.WA_RETRY_BASE_MS || 400);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetry(err) {
  if (!err.response) return true;
  const status = err.response.status;
  return status === 429 || status >= 500;
}

// Shared WhatsApp Graph API sender with timeout and bounded retry/backoff.
async function waPost(to, payload) {
  const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;

  for (let attempt = 0; attempt <= WA_RETRY_COUNT; attempt++) {
    try {
      return await axios.post(
        url,
        { messaging_product: "whatsapp", to, ...payload },
        {
          timeout: WA_TIMEOUT_MS,
          headers: {
            Authorization: `Bearer ${TOKEN}`,
            "Content-Type": "application/json",
          },
        }
      );
    } catch (err) {
      const canRetry = attempt < WA_RETRY_COUNT && shouldRetry(err);
      if (!canRetry) throw err;

      const waitMs = WA_RETRY_BASE_MS * 2 ** attempt;
      logger.warn("whatsapp_api_retry", {
        to,
        attempt: attempt + 1,
        waitMs,
        status: err.response?.status,
        error: err.message,
      });
      await sleep(waitMs);
    }
  }
}

async function sendMainMenu(to, isGreeting = false) {
  const bodyText = isGreeting
    ? "Hey 👋 Welcome to *Finfinity*!\n\nHow can we help you today?"
    : "Here's what we can help you with 👇\n\nPlease choose an option to continue:";

  await waPost(to, {
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: bodyText },
      action: {
        buttons: [
          { type: "reply", reply: { id: "MAIN_LOANS", title: "💰 Apply for a Loan" } },
          { type: "reply", reply: { id: "MAIN_PARTNER", title: "🤝 Partner with Us" } },
          { type: "reply", reply: { id: "MAIN_CONTACT", title: "📞 Contact Us" } },
        ],
      },
    },
  });
}

async function sendLoanSubMenu(to) {
  await waPost(to, {
    type: "interactive",
    interactive: {
      type: "button",
      body: {
        text: "Great! 💼 Which type of loan are you interested in?\n\nChoose one below and we'll take you to the application:",
      },
      action: {
        buttons: [
          { type: "reply", reply: { id: "EDU_LOAN", title: "🎓 Education Loan" } },
          { type: "reply", reply: { id: "PERSONAL_LOAN", title: "💳 Personal Loan" } },
          { type: "reply", reply: { id: "HOME_LOAN", title: "🏠 Home Loan" } },
        ],
      },
    },
  });
}

async function sendPartnerSubMenu(to) {
  await waPost(to, {
    type: "interactive",
    interactive: {
      type: "list",
      body: {
        text: "We'd love to have you on board! 🚀\n\nPlease select the type of partnership you're interested in:",
      },
      action: {
        button: "Choose Partnership",
        sections: [
          {
            title: "Partnership Types",
            rows: [
              {
                id: "PARTNER_CORP",
                title: "🏢 Corporate Partnership",
                description: "Strategic business tie-ups",
              },
              {
                id: "PARTNER_DEV",
                title: "👨‍💻 Developer Partner",
                description: "API & tech integrations",
              },
              {
                id: "PARTNER_AFFILIATE",
                title: "🔗 Affiliate Partner",
                description: "Earn by referring customers",
              },
              {
                id: "PARTNER_DIGITAL",
                title: "📱 Digital Partner",
                description: "Digital marketing collaborations",
              },
            ],
          },
        ],
      },
    },
  });
}

async function sendContactSubMenu(to) {
  await waPost(to, {
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: "We're here to help! 🙌\n\nWhat would you like to do?" },
      action: {
        buttons: [
          { type: "reply", reply: { id: "CONTACT_RM", title: "🧑‍💼 Speak to an RM" } },
          { type: "reply", reply: { id: "CONTACT_FAQ", title: "📖 Read FAQs" } },
          { type: "reply", reply: { id: "CONTACT_GRIEVANCE", title: "📝 Raise a Grievance" } },
        ],
      },
    },
  });
}

async function sendFAQs(to) {
  const faqText =
    "*📖 Frequently Asked Questions*\n\n" +
    "*Q1. What is Finfinity?*\n" +
    "Finfinity is a digital platform where you can explore financial products like loans, investments, DigiGold/DigiSilver, and wellness services in one place.\n\n" +
    "*Q2. What products can I access on Finfinity?*\n" +
    "On Finfinity you can explore personal loans, home loans, business loans, DigiGold, DigiSilver, investment options, and wellness partner services.\n\n" +
    "*Q3. What are DigiGold and DigiSilver on Finfinity and who powers them?*\n" +
    "DigiGold and DigiSilver allow you to buy gold and silver digitally in small amounts starting from just ₹10. Finfinity has partnered with Augmont, ensuring that every purchase is backed by 100% physical gold or silver stored in secure vaults.\n\n" +
    "*Q4. How can I download the Finfinity app?*\n" +
    "You can download the Finfinity app from the Google Play Store or Apple App Store and start exploring financial products easily: https://sgpl.finfinity.co.in/FinApp/\n\n" +
    "*Q5. Is it free to sign up on Finfinity?*\n" +
    "Yes, signing up on Finfinity is completely free, and you can browse and compare products before applying or investing.\n\n" +
    "_Have more questions? Just type anything and we'll bring up the menu again!_";

  await waPost(to, { type: "text", text: { body: faqText } });
}

async function sendThankYouGeneric(to, message) {
  await waPost(to, { type: "text", text: { body: message } });
}

// Sends a CTA URL message tailored to the selected product.
async function sendWebviewLink(to, productLabel, productKey) {
  const copy = {
    EDU_LOAN: {
      emoji: "🎓",
      headline: "Education Loan - Let's get you started!",
      body: "Invest in your future with the right financial support.\nOur team is here to make your education loan journey smooth and hassle-free.",
    },
    PERSONAL_LOAN: {
      emoji: "💳",
      headline: "Personal Loan - Quick & Easy!",
      body: "Need funds for any personal goal? We've got you covered.\nFast approvals, minimal paperwork - let's move forward together.",
    },
    HOME_LOAN: {
      emoji: "🏠",
      headline: "Home Loan - Your dream home awaits!",
      body: "Take the first step towards owning your dream home.\nCompetitive rates, flexible tenure - our experts will guide you through every step.",
    },
  };

  const content = copy[productKey] || {
    emoji: "✨",
    headline: `${productLabel} - Let's get started!`,
    body: "Our team is ready to help you take the next step.",
  };

  const bodyText =
    `${content.emoji} *${content.headline}*\n\n` +
    `${content.body}\n\n` +
    "Tap the button below to begin your application.";

  const header = IMAGE_URL ? { type: "image", image: { link: IMAGE_URL } } : undefined;

  const interactive = {
    type: "cta_url",
    ...(header && { header }),
    body: { text: bodyText },
    footer: { text: "Finfinity Financial Services" },
    action: {
      name: "cta_url",
      parameters: {
        display_text: "Apply Now ->",
        url: WEBVIEW_LINK,
      },
    },
  };

  await waPost(to, {
    type: "interactive",
    interactive,
  });

  logger.info("cta_message_sent", { to, productLabel });
}

module.exports = {
  sendMainMenu,
  sendLoanSubMenu,
  sendPartnerSubMenu,
  sendContactSubMenu,
  sendFAQs,
  sendThankYouGeneric,
  sendWebviewLink,
};

require("dotenv").config();
const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const app = express();

/* ================= CONFIG ================= */
const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.WA_VERIFY_TOKEN || "finfinity_verify_token";
const TOKEN = process.env.TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

const WEBVIEW_LINK = "https://frm.finfinity.co.in/?utm_campaign=RITEN";
const CSV_FILE = path.join(__dirname, "leads.csv");

if (!TOKEN || !PHONE_NUMBER_ID) {
  console.error("❌ Missing TOKEN or PHONE_NUMBER_ID");
  process.exit(1);
}

/* ================= CSV SETUP ================= */
if (!fs.existsSync(CSV_FILE)) {
  fs.writeFileSync(
    CSV_FILE,
    "phone_number,product,timestamp\n",
    "utf8"
  );
}

/* ================= MIDDLEWARE ================= */
app.use(express.json({ limit: "2mb" }));

app.use((req, res, next) => {
  console.log(`REQ: ${req.method} ${req.url}`);
  next();
});

/* ================= HEALTH ================= */
app.get("/", (req, res) => res.send("OK"));
app.get("/ping", (req, res) =>
  res.json({ ok: true, time: new Date().toISOString() })
);

/* ================= WEBHOOK VERIFY ================= */
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

/* ================= WEBHOOK RECEIVER ================= */
app.post("/webhook", async (req, res) => {
  console.log("Incoming webhook:\n", JSON.stringify(req.body, null, 2));

  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    if (!message) return res.sendStatus(200);

    const from = message.from;

    /* -------- TEXT MESSAGE (ANY TEXT) -------- */
    if (message.type === "text") {
      const text = message.text?.body?.toLowerCase()?.trim();
      console.log("User text:", text);

      const isGreeting = text === "hi" || text === "hello";

      // ALWAYS show menu for any text
      await sendMenuButtons(from, isGreeting);
    }

    /* -------- BUTTON CLICK -------- */
    if (message.type === "interactive") {
      const buttonId = message.interactive?.button_reply?.id;
      console.log("Button clicked:", buttonId);

      if (
        buttonId === "EDU_LOAN" ||
        buttonId === "PERSONAL_LOAN" ||
        buttonId === "HOME_LOAN"
      ) {
        logLead(from, buttonId);
        await sendWebviewLink(from);
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Webhook error:", err.response?.data || err.message);
    res.sendStatus(200);
  }
});

/* ================= SEND MENU BUTTONS ================= */
async function sendMenuButtons(to, isGreeting = false) {
  const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;

  const messageText = isGreeting
    ? "Hi 👋 Welcome to Finfinity!\n\nWhat are you looking for?"
    : "I can help you with the following options 👇\n\nPlease choose one to continue:";

  await axios.post(
    url,
    {
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "button",
        body: {
          text: messageText,
        },
        action: {
          buttons: [
            {
              type: "reply",
              reply: { id: "EDU_LOAN", title: "🎓 Education Loan" },
            },
            {
              type: "reply",
              reply: { id: "PERSONAL_LOAN", title: "💳 Personal Loan" },
            },
            {
              type: "reply",
              reply: { id: "HOME_LOAN", title: "🏠 Home Loan" },
            },
          ],
        },
      },
    },
    {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
}

/* ================= SEND WEBVIEW LINK ================= */
async function sendWebviewLink(to) {
  const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;

  await axios.post(
    url,
    {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: {
        body: `Great choice! 👌\n\nPlease continue your journey here:\n${WEBVIEW_LINK}`,
      },
    },
    {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );

  console.log("✅ Webview link sent to", to);
}

/* ================= CSV LOGGING ================= */
function logLead(phone, product) {
  const timestamp = new Date().toISOString();
  const row = `${phone},${product},${timestamp}\n`;

  fs.appendFile(CSV_FILE, row, (err) => {
    if (err) {
      console.error("❌ CSV write error:", err);
    } else {
      console.log("📄 Lead logged:", phone, product);
    }
  });
}

/* ================= START SERVER ================= */
app.listen(PORT, () => {
  console.log(`🚀 Webhook server running on http://localhost:${PORT}`);
});
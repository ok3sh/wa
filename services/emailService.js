const nodemailer = require("nodemailer");

const logger = require("../utils/logger");

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = String(process.env.SMTP_SECURE || "false").toLowerCase() === "true";
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const EMAIL_FROM = process.env.EMAIL_FROM || SMTP_USER || "no-reply@finfinity.co.in";
const EMAIL_TO = process.env.EMAIL_TO || "connect@finfinity.co.in";

// Singleton transporter — created once and reused for all sends to avoid
// per-call TCP connection exhaustion and SMTP rate-limit thrashing.
let _transporter = null;
let warnedMissingEmailConfig = false;

function isEmailConfigured() {
  return Boolean(SMTP_HOST && SMTP_PORT && EMAIL_TO);
}

function getTransporter() {
  if (!isEmailConfigured()) {
    if (!warnedMissingEmailConfig) {
      warnedMissingEmailConfig = true;
      logger.warn("email_notifications_disabled", {
        reason: "Set SMTP_HOST and SMTP_PORT to enable email notifications",
      });
    }
    return null;
  }

  if (_transporter) return _transporter;

  const transportConfig = {
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
  };

  // Support IP-whitelisted relays that do not require SMTP AUTH.
  if (SMTP_USER && SMTP_PASS) {
    transportConfig.auth = {
      user: SMTP_USER,
      pass: SMTP_PASS,
    };
  }

  _transporter = nodemailer.createTransport(transportConfig);
  return _transporter;
}

function escHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inferFlowType(flow = "") {
  const f = String(flow).toLowerCase();
  if (f.includes("grievance")) return "Grievance";
  if (f.includes("loan") || f.includes("product selected")) return "Loan";
  if (f.includes("partner")) return "Partner";
  if (f.includes("contact") || f.includes("faq") || f.includes("rm")) return "Contact";
  return "General";
}

function buildSubject(flowType, flow, identifier) {
  const titleMap = {
    Loan: "Loan Flow",
    Partner: "Partnership Flow",
    Contact: "Contact Flow",
    Grievance: "Grievance Flow",
    General: "General Entry",
  };

  const prefix = titleMap[flowType] || titleMap.General;
  return `[Finfinity WA][${prefix}] ${flow || "New Entry"} - ${identifier}`;
}

async function notifyNewEntryEmail({
  phone,
  waId,
  contactName,
  messageId,
  flow,
  selectionId,
  selectionLabel,
  userMessage,
}) {
  const transporter = getTransporter();
  if (!transporter) return false;

  const nowIso = new Date().toISOString();
  const flowType = inferFlowType(flow);
  const identifier = phone || waId || "unknown";
  const subject = buildSubject(flowType, flow, identifier);

  const details = [
    `Timestamp: ${nowIso}`,
    `Contact Name: ${contactName || "N/A"}`,
    `Phone: ${phone || "N/A"}`,
    `WA ID: ${waId || "N/A"}`,
    `Message ID: ${messageId || "N/A"}`,
    `Flow: ${flow || "N/A"}`,
    `Selection ID: ${selectionId || "N/A"}`,
    `Selection Label: ${selectionLabel || "N/A"}`,
    `User Message: ${userMessage || "N/A"}`,
  ];

  const textBody =
    "A new WhatsApp entry was recorded in Finfinity WA Bot.\n\n" + details.join("\n");

  const safe = {
    nowIso: escHtml(nowIso),
    flowType: escHtml(flowType),
    contactName: escHtml(contactName || "N/A"),
    phone: escHtml(phone || "N/A"),
    waId: escHtml(waId || "N/A"),
    messageId: escHtml(messageId || "N/A"),
    flow: escHtml(flow || "N/A"),
    selectionId: escHtml(selectionId || "N/A"),
    selectionLabel: escHtml(selectionLabel || "N/A"),
    userMessage: escHtml(userMessage || "N/A"),
  };

  const htmlBody = `
    <div style="margin:0;padding:20px;background:#f5f8ff;font-family:Arial,sans-serif;color:#172b4d;">
      <div style="max-width:760px;margin:0 auto;background:#ffffff;border:1px solid #dbe4f6;border-radius:12px;overflow:hidden;">
        <div style="padding:16px 20px;background:#0b2d66;color:#ffffff;">
          <div style="font-size:18px;font-weight:700;">Finfinity WhatsApp Intake Alert</div>
          <div style="font-size:12px;opacity:0.9;margin-top:4px;">${safe.flowType} Notification</div>
        </div>
        <div style="padding:18px 20px;">
          <p style="margin:0 0 14px 0;font-size:14px;">A new WhatsApp interaction has been captured.</p>
          <table cellpadding="8" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:13px;">
            <tr><td style="width:180px;border:1px solid #e5ebf8;background:#f8faff;"><strong>Timestamp</strong></td><td style="border:1px solid #e5ebf8;">${safe.nowIso}</td></tr>
            <tr><td style="border:1px solid #e5ebf8;background:#f8faff;"><strong>Contact Name</strong></td><td style="border:1px solid #e5ebf8;">${safe.contactName}</td></tr>
            <tr><td style="border:1px solid #e5ebf8;background:#f8faff;"><strong>Phone</strong></td><td style="border:1px solid #e5ebf8;">${safe.phone}</td></tr>
            <tr><td style="border:1px solid #e5ebf8;background:#f8faff;"><strong>WA ID</strong></td><td style="border:1px solid #e5ebf8;">${safe.waId}</td></tr>
            <tr><td style="border:1px solid #e5ebf8;background:#f8faff;"><strong>Message ID</strong></td><td style="border:1px solid #e5ebf8;">${safe.messageId}</td></tr>
            <tr><td style="border:1px solid #e5ebf8;background:#f8faff;"><strong>Flow</strong></td><td style="border:1px solid #e5ebf8;">${safe.flow}</td></tr>
            <tr><td style="border:1px solid #e5ebf8;background:#f8faff;"><strong>Selection ID</strong></td><td style="border:1px solid #e5ebf8;">${safe.selectionId}</td></tr>
            <tr><td style="border:1px solid #e5ebf8;background:#f8faff;"><strong>Selection Label</strong></td><td style="border:1px solid #e5ebf8;">${safe.selectionLabel}</td></tr>
            <tr><td style="border:1px solid #e5ebf8;background:#f8faff;"><strong>User Message</strong></td><td style="border:1px solid #e5ebf8;white-space:pre-wrap;">${safe.userMessage}</td></tr>
          </table>
        </div>
      </div>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: EMAIL_FROM,
      to: EMAIL_TO,
      subject,
      text: textBody,
      html: htmlBody,
    });

    logger.info("email_notification_sent", {
      phone,
      flow,
      to: EMAIL_TO,
    });

    return true;
  } catch (err) {
    logger.error("email_notification_failed", {
      error: err.message,
      flow,
      phone,
      to: EMAIL_TO,
    });

    return false;
  }
}

module.exports = {
  notifyNewEntryEmail,
};

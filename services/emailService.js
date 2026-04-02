const nodemailer = require("nodemailer");

const logger = require("../utils/logger");

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = String(process.env.SMTP_SECURE || "false").toLowerCase() === "true";
const SMTP_IGNORE_TLS_ENV = process.env.SMTP_IGNORE_TLS;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const EMAIL_FROM = process.env.EMAIL_FROM || SMTP_USER || "no-reply@finfinity.co.in";
const EMAIL_TO = process.env.EMAIL_TO || "admin@finfinity.co";

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
    connectionTimeout: 10000,
    socketTimeout: 10000,
  };

  // Port 25 relays commonly reject STARTTLS in locked-down environments.
  // Allow explicit override via SMTP_IGNORE_TLS; default to true on port 25.
  const smtpIgnoreTlsConfigured =
    SMTP_IGNORE_TLS_ENV != null && SMTP_IGNORE_TLS_ENV !== "";
  const shouldIgnoreTls = SMTP_SECURE
    ? false
    : smtpIgnoreTlsConfigured
      ? String(SMTP_IGNORE_TLS_ENV).toLowerCase() === "true"
      : SMTP_PORT === 25;
  if (shouldIgnoreTls) {
    transportConfig.ignoreTLS = true;
  }

  if (SMTP_PORT === 25) {
    transportConfig.requireTLS = false;
  }

  if (SMTP_SECURE || SMTP_PORT === 587) {
    transportConfig.tls = { rejectUnauthorized: false };
  }

  if (SMTP_USER && SMTP_PASS) {
    transportConfig.auth = { user: SMTP_USER, pass: SMTP_PASS };
  }

  _transporter = nodemailer.createTransport(transportConfig);

  logger.info("email_transporter_created", {
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    ignoreTLS: !!transportConfig.ignoreTLS,
    authEnabled: !!(SMTP_USER && SMTP_PASS),
    from: EMAIL_FROM,
    to: EMAIL_TO,
  });

  return _transporter;
}

function escHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Convert UTC ISO string to IST for display (UTC+5:30).
function toIST(isoString) {
  try {
    const d = new Date(isoString);
    if (isNaN(d)) return isoString;
    return new Date(d.getTime() + 5.5 * 60 * 60 * 1000)
      .toISOString()
      .replace("T", " ")
      .replace("Z", "")
      .slice(0, 19) + " IST";
  } catch {
    return isoString;
  }
}

// Pick the most "interesting" flow type across all session steps for the subject line.
function inferSessionFlowType(steps = []) {
  const priority = ["Grievance", "Loan", "Partner", "Contact", "General"];
  const found = new Set();

  for (const step of steps) {
    const f = String(step.flow || "").toLowerCase();
    if (f.includes("grievance")) found.add("Grievance");
    else if (f.includes("loan") || f.includes("product selected")) found.add("Loan");
    else if (f.includes("partner")) found.add("Partner");
    else if (f.includes("contact") || f.includes("faq") || f.includes("rm")) found.add("Contact");
    else found.add("General");
  }

  return priority.find((p) => found.has(p)) || "General";
}

/**
 * Sends a single session-summary email for one user after they go quiet.
 *
 * @param {object} opts
 * @param {string} opts.phone      - sender phone number
 * @param {string} opts.waId       - WhatsApp ID
 * @param {string} opts.contactName - display name (may be empty)
 * @param {Array}  opts.steps      - array of { ts, flow, selectionId, selectionLabel, userMessage }
 */
async function notifySessionEmail({ phone, waId, contactName, steps = [] }) {
  const transporter = getTransporter();
  if (!transporter) return false;
  if (!steps.length) return false;

  const name = contactName || "Unknown";
  const identifier = name !== "Unknown" ? `${name} – ${phone}` : phone;
  const flowType = inferSessionFlowType(steps);

  const flowLabel = {
    Loan: "Loan Interest",
    Partner: "Partnership Interest",
    Contact: "Contact / Support",
    Grievance: "Grievance",
    General: "General Enquiry",
  }[flowType] || "General Enquiry";

  const subject = `[Finfinity WA] ${identifier} — ${flowLabel}`;

  const sessionStart = toIST(steps[0].ts);
  const sessionEnd = toIST(steps[steps.length - 1].ts);

  // ── Plain-text body ────────────────────────────────────────────────────────
  const stepLines = steps.map((s, i) => {
    let line = `  Step ${i + 1} [${toIST(s.ts)}]  ${s.flow}`;
    if (s.selectionLabel) line += `\n    → Selected: ${s.selectionLabel}`;
    if (s.userMessage) line += `\n    → Typed: "${s.userMessage}"`;
    return line;
  });

  const textBody = [
    "Finfinity WhatsApp Session Summary",
    "─".repeat(40),
    `Contact Name : ${name}`,
    `Phone        : ${phone || "N/A"}`,
    `WA ID        : ${waId || "N/A"}`,
    `Session Start: ${sessionStart}`,
    `Session End  : ${sessionEnd}`,
    `Total Steps  : ${steps.length}`,
    "",
    "User Journey:",
    ...stepLines,
  ].join("\n");

  // ── HTML body ──────────────────────────────────────────────────────────────
  const stepRows = steps
    .map((s, i) => {
      const detailParts = [];
      if (s.selectionLabel) {
        detailParts.push(
          `<div style="margin-top:6px;color:#0f3c8a;"><strong>Selected:</strong> ${escHtml(s.selectionLabel)}</div>`
        );
      }
      if (s.userMessage) {
        detailParts.push(
          `<div style="margin-top:6px;color:#414b5f;"><strong>Typed:</strong> <em>"${escHtml(s.userMessage)}"</em></div>`
        );
      }
      const detail = detailParts.join("");

      const rowBg = i % 2 === 0 ? "#ffffff" : "#f7f9ff";
      return `
        <tr style="background:${rowBg};">
          <td style="border:1px solid #dbe5fb;padding:10px 12px;text-align:center;color:#7d8aa8;font-size:12px;font-weight:700;vertical-align:top;">${i + 1}</td>
          <td style="border:1px solid #dbe5fb;padding:10px 12px;font-size:12px;color:#4a5570;white-space:nowrap;vertical-align:top;">${escHtml(toIST(s.ts))}</td>
          <td style="border:1px solid #dbe5fb;padding:10px 12px;font-size:13px;color:#1b2740;vertical-align:top;"><div style="font-weight:600;">${escHtml(s.flow)}</div>${detail}</td>
        </tr>`;
    })
    .join("");

  const statCard = (label, value) => `
    <td style="width:33.33%;padding:6px;vertical-align:top;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;background:#f5f8ff;border:1px solid #dbe5fb;border-radius:10px;">
        <tr>
          <td style="padding:10px 12px;">
            <div style="font-size:11px;color:#687694;text-transform:uppercase;letter-spacing:.04em;">${escHtml(label)}</div>
            <div style="margin-top:4px;font-size:14px;color:#16253d;font-weight:700;">${escHtml(value)}</div>
          </td>
        </tr>
      </table>
    </td>
  `;

  const htmlBody = `
    <div style="margin:0;padding:22px;background:#ecf2ff;font-family:Arial,sans-serif;color:#16253d;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:760px;margin:0 auto;border-collapse:collapse;background:#ffffff;border:1px solid #d6e1fa;border-radius:14px;overflow:hidden;">
        <tr>
          <td style="padding:18px 22px;background:linear-gradient(90deg,#0b2d66 0%,#1a4ca8 100%);color:#ffffff;">
            <div style="font-size:12px;opacity:0.9;letter-spacing:.06em;text-transform:uppercase;">Finfinity WhatsApp Bot</div>
            <div style="margin-top:5px;font-size:20px;font-weight:700;">Session Summary</div>
            <div style="margin-top:8px;display:inline-block;font-size:12px;font-weight:600;background:rgba(255,255,255,0.14);padding:4px 10px;border-radius:999px;">${escHtml(flowLabel)}</div>
          </td>
        </tr>

        <tr>
          <td style="padding:16px 16px 4px;">
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">
              <tr>
                ${statCard("Contact", name)}
                ${statCard("Phone", phone || "N/A")}
                ${statCard("WA ID", waId || "N/A")}
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td style="padding:4px 16px 8px;">
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">
              <tr>
                ${statCard("Session Start", sessionStart)}
                ${statCard("Session End", sessionEnd)}
                ${statCard("Total Steps", String(steps.length))}
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td style="padding:8px 22px 12px;font-size:14px;font-weight:700;color:#14366f;">User Journey Timeline</td>
        </tr>

        <tr>
          <td style="padding:0 22px 22px;">
            <table cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;font-size:13px;">
              <thead>
                <tr style="background:#153b7f;color:#ffffff;">
                  <th style="border:1px solid #0f316d;padding:9px 10px;font-size:12px;width:44px;">#</th>
                  <th style="border:1px solid #0f316d;padding:9px 10px;font-size:12px;text-align:left;white-space:nowrap;">Time (IST)</th>
                  <th style="border:1px solid #0f316d;padding:9px 10px;font-size:12px;text-align:left;">Action Details</th>
                </tr>
              </thead>
              <tbody>
                ${stepRows}
              </tbody>
            </table>
          </td>
        </tr>
      </table>
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

    logger.info("session_email_sent", { phone, steps: steps.length, to: EMAIL_TO });
    return true;
  } catch (err) {
    logger.error("session_email_failed", { error: err.message, phone, to: EMAIL_TO });
    return false;
  }
}

async function verifyEmailTransport() {
  const configured = isEmailConfigured();
  const smtpIgnoreTlsConfigured =
    SMTP_IGNORE_TLS_ENV != null && SMTP_IGNORE_TLS_ENV !== "";
  const ignoreTLS = SMTP_SECURE
    ? false
    : smtpIgnoreTlsConfigured
      ? String(SMTP_IGNORE_TLS_ENV).toLowerCase() === "true"
      : SMTP_PORT === 25;

  const details = {
    configured,
    host: SMTP_HOST || null,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    ignoreTLS,
    authEnabled: !!(SMTP_USER && SMTP_PASS),
    from: EMAIL_FROM,
    to: EMAIL_TO,
  };

  if (!configured) {
    return {
      ok: false,
      reason: "SMTP not configured. Set SMTP_HOST and SMTP_PORT.",
      details,
    };
  }

  try {
    const transporter = getTransporter();
    await transporter.verify();

    logger.info("email_transport_verified", {
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      ignoreTLS,
      authEnabled: !!(SMTP_USER && SMTP_PASS),
    });

    return {
      ok: true,
      reason: "SMTP connection verified.",
      details,
    };
  } catch (err) {
    logger.error("email_transport_verify_failed", {
      error: err.message,
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      ignoreTLS,
      authEnabled: !!(SMTP_USER && SMTP_PASS),
    });

    return {
      ok: false,
      reason: err.message,
      details,
    };
  }
}

module.exports = {
  notifySessionEmail,
  verifyEmailTransport,
};

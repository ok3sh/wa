const nodemailer = require("nodemailer");

const logger = require("../utils/logger");

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = String(process.env.SMTP_SECURE || "false").toLowerCase() === "true";
const SMTP_IGNORE_TLS_ENV = process.env.SMTP_IGNORE_TLS;
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
          `<span style="color:#0b2d66;"><strong>→ Selected:</strong> ${escHtml(s.selectionLabel)}</span>`
        );
      }
      if (s.userMessage) {
        detailParts.push(
          `<span style="color:#444;"><strong>→ Typed:</strong> <em>"${escHtml(s.userMessage)}"</em></span>`
        );
      }
      const detail = detailParts.length
        ? `<br><span style="display:block;padding-left:8px;margin-top:4px;font-size:12px;">${detailParts.join("<br>")}</span>`
        : "";

      const rowBg = i % 2 === 0 ? "#ffffff" : "#f8faff";
      return `
        <tr style="background:${rowBg};">
          <td style="border:1px solid #e5ebf8;padding:8px 10px;text-align:center;color:#888;font-size:12px;">${i + 1}</td>
          <td style="border:1px solid #e5ebf8;padding:8px 10px;font-size:12px;color:#555;white-space:nowrap;">${escHtml(toIST(s.ts))}</td>
          <td style="border:1px solid #e5ebf8;padding:8px 10px;font-size:13px;">${escHtml(s.flow)}${detail}</td>
        </tr>`;
    })
    .join("");

  const htmlBody = `
    <div style="margin:0;padding:20px;background:#f5f8ff;font-family:Arial,sans-serif;color:#172b4d;">
      <div style="max-width:760px;margin:0 auto;background:#ffffff;border:1px solid #dbe4f6;border-radius:12px;overflow:hidden;">

        <div style="padding:16px 20px;background:#0b2d66;color:#ffffff;">
          <div style="font-size:18px;font-weight:700;">Finfinity — WhatsApp Session Summary</div>
          <div style="font-size:12px;opacity:0.85;margin-top:4px;">${escHtml(flowLabel)}</div>
        </div>

        <div style="padding:18px 20px;">

          <table cellpadding="7" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px;">
            <tr>
              <td style="width:140px;border:1px solid #e5ebf8;background:#f8faff;"><strong>Contact Name</strong></td>
              <td style="border:1px solid #e5ebf8;">${escHtml(name)}</td>
            </tr>
            <tr>
              <td style="border:1px solid #e5ebf8;background:#f8faff;"><strong>Phone</strong></td>
              <td style="border:1px solid #e5ebf8;">${escHtml(phone || "N/A")}</td>
            </tr>
            <tr>
              <td style="border:1px solid #e5ebf8;background:#f8faff;"><strong>WA ID</strong></td>
              <td style="border:1px solid #e5ebf8;">${escHtml(waId || "N/A")}</td>
            </tr>
            <tr>
              <td style="border:1px solid #e5ebf8;background:#f8faff;"><strong>Session Start</strong></td>
              <td style="border:1px solid #e5ebf8;">${escHtml(sessionStart)}</td>
            </tr>
            <tr>
              <td style="border:1px solid #e5ebf8;background:#f8faff;"><strong>Session End</strong></td>
              <td style="border:1px solid #e5ebf8;">${escHtml(sessionEnd)}</td>
            </tr>
          </table>

          <div style="font-size:14px;font-weight:700;margin-bottom:10px;color:#0b2d66;">
            User Journey &nbsp;<span style="font-weight:400;font-size:12px;color:#888;">(${steps.length} step${steps.length !== 1 ? "s" : ""})</span>
          </div>

          <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead>
              <tr style="background:#0b2d66;color:#fff;">
                <th style="border:1px solid #09245a;padding:8px 10px;font-size:12px;width:40px;">#</th>
                <th style="border:1px solid #09245a;padding:8px 10px;font-size:12px;text-align:left;white-space:nowrap;">Time (IST)</th>
                <th style="border:1px solid #09245a;padding:8px 10px;font-size:12px;text-align:left;">Action</th>
              </tr>
            </thead>
            <tbody>
              ${stepRows}
            </tbody>
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

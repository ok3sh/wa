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

// NOTE: For analytics we keep human-readable product names here.
// (Later when we move to Postgres, this becomes a lookup table / enum.)
const PRODUCT_MAP = {
  EDU_LOAN: "Education Loan",
  PERSONAL_LOAN: "Personal Loan",
  HOME_LOAN: "Home Loan",
};

if (!TOKEN || !PHONE_NUMBER_ID) {
  console.error("❌ Missing TOKEN or PHONE_NUMBER_ID");
  process.exit(1);
}

/* ================= CSV SETUP ================= */
// Add extra columns NOW so we're future-ready (message_id, wa_id).
// (This still works even if your existing CSV only has 3 columns; we’ll parse safely.)
const CSV_HEADER = "timestamp,phone_number,wa_id,product,product_label,message_id\n";
if (!fs.existsSync(CSV_FILE)) {
  fs.writeFileSync(CSV_FILE, CSV_HEADER, "utf8");
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
app.get("/logo", (req, res) =>
  res.sendFile(path.join(__dirname, "fin_logo.jpg"))
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
  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    // Always 200 to Meta
    if (!message) return res.sendStatus(200);

    const from = message.from; // user's wa_id-ish number (string)
    const wa_id = value?.contacts?.[0]?.wa_id || from;
    const messageId = message.id;

    /* -------- TEXT MESSAGE (ANY TEXT) -------- */
    if (message.type === "text") {
      const text = message.text?.body?.toLowerCase()?.trim();
      console.log("User text:", text);

      const isGreeting = text === "hi" || text === "hello";
      // Always show menu for any text (gibberish/help/etc -> menu)
      await sendMenuButtons(from, isGreeting);
    }

    /* -------- BUTTON CLICK -------- */
    if (message.type === "interactive") {
      const buttonId = message.interactive?.button_reply?.id;
      console.log("Button clicked:", buttonId);

      if (PRODUCT_MAP[buttonId]) {
        logLead({
          phone: from,
          wa_id,
          product: buttonId,
          productLabel: PRODUCT_MAP[buttonId],
          messageId,
        });
        await sendWebviewLink(from, PRODUCT_MAP[buttonId], buttonId);
      }
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error("Webhook error:", err.response?.data || err.message);
    return res.sendStatus(200);
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
        body: { text: messageText },
        action: {
          buttons: [
            { type: "reply", reply: { id: "EDU_LOAN", title: "🎓 Education Loan" } },
            { type: "reply", reply: { id: "PERSONAL_LOAN", title: "💳 Personal Loan" } },
            { type: "reply", reply: { id: "HOME_LOAN", title: "🏠 Home Loan" } },
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
async function sendWebviewLink(to, productLabel, productKey) {
  const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;

  // Per-product personalised copy
  const COPY = {
    EDU_LOAN: {
      emoji: "🎓",
      headline: "Education Loan – Let's get you started!",
      body: "Invest in your future with the right financial support.\nOur team is here to make your education loan journey smooth and hassle-free.",
    },
    PERSONAL_LOAN: {
      emoji: "💳",
      headline: "Personal Loan – Quick & Easy!",
      body: "Need funds for any personal goal? We've got you covered.\nFast approvals, minimal paperwork – let's move forward together.",
    },
    HOME_LOAN: {
      emoji: "🏠",
      headline: "Home Loan – Your dream home awaits!",
      body: "Take the first step towards owning your dream home.\nCompetitive rates, flexible tenure – our experts will guide you through every step.",
    },
  };

  const c = COPY[productKey] || {
    emoji: "✨",
    headline: `${productLabel} – Let's get started!`,
    body: "Our team is ready to help you take the next step.",
  };

  const bodyText =
    `${c.emoji} *${c.headline}*\n\n` +
    `${c.body}\n\n` +
    `Tap the button below to begin your application �`;

  // Optional image header — set IMAGE_URL in your .env to enable
  const imageUrl = process.env.IMAGE_URL;
  const header = imageUrl
    ? { type: "image", image: { link: imageUrl } }
    : undefined;

  const interactive = {
    type: "cta_url",
    ...(header && { header }),
    body: { text: bodyText },
    footer: { text: "Finfinity Financial Services" },
    action: {
      name: "cta_url",
      parameters: {
        display_text: "Apply Now →",
        url: WEBVIEW_LINK,
      },
    },
  };

  await axios.post(
    url,
    {
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive,
    },
    {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );

  console.log("✅ CTA message sent to", to, "|", productLabel);
}

/* ================= CSV LOGGING ================= */
function logLead({ phone, wa_id, product, productLabel, messageId }) {
  const timestamp = new Date().toISOString();

  // CSV-safe minimal escaping (quotes + replace quotes inside)
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

  const row =
    [
      esc(timestamp),
      esc(phone),
      esc(wa_id),
      esc(product),
      esc(productLabel),
      esc(messageId),
    ].join(",") + "\n";

  fs.appendFile(CSV_FILE, row, (err) => {
    if (err) console.error("❌ CSV write error:", err);
    else console.log("📄 Lead logged:", phone, product);
  });
}

/* ================= ANALYTICS (CSV -> Aggregates) ================= */
// Parse CSV safely even if older rows have fewer columns (your earlier 3-col format)
function readLeadsFromCsv() {
  if (!fs.existsSync(CSV_FILE)) return [];

  const raw = fs.readFileSync(CSV_FILE, "utf8").trim();
  if (!raw) return [];

  const lines = raw.split("\n");
  // Remove header line if present
  const startIdx = lines[0].includes("timestamp") ? 1 : 0;

  const leads = [];
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // If row is quoted CSV, splitting by comma is not perfect; but our writer always quotes each field,
    // so we can parse with a simple regex for quoted fields:
    const quotedFields = line.match(/"([^"]|"")*"/g);

    if (quotedFields && quotedFields.length >= 3) {
      const unq = (q) => q.slice(1, -1).replace(/""/g, '"');
      const fields = quotedFields.map(unq);

      // New format: timestamp, phone_number, wa_id, product, product_label, message_id
      if (fields.length >= 6) {
        leads.push({
          timestamp: fields[0],
          phone_number: fields[1],
          wa_id: fields[2],
          product: fields[3],
          product_label: fields[4],
          message_id: fields[5],
        });
        continue;
      }

      // Old format compatibility (if you ever had 3 columns): phone_number,product,timestamp
      // Some old rows might not be quoted; we handle below as well.
    }

    // Fallback for very old rows like: phone,product,timestamp (no quotes)
    const parts = line.split(",");
    if (parts.length >= 3) {
      // Try detect whether timestamp is first or last
      const maybeTsFirst = parts[0];
      const maybeTsLast = parts[parts.length - 1];
      const isoLike = (s) => /^\d{4}-\d{2}-\d{2}T/.test(s);

      if (isoLike(maybeTsFirst)) {
        leads.push({
          timestamp: maybeTsFirst,
          phone_number: parts[1],
          wa_id: parts[1],
          product: parts[2],
          product_label: PRODUCT_MAP[parts[2]] || parts[2],
          message_id: "",
        });
      } else if (isoLike(maybeTsLast)) {
        leads.push({
          timestamp: maybeTsLast,
          phone_number: parts[0],
          wa_id: parts[0],
          product: parts[1],
          product_label: PRODUCT_MAP[parts[1]] || parts[1],
          message_id: "",
        });
      }
    }
  }

  return leads;
}

function computeAnalytics(leads) {
  const totalLeads = leads.length;

  // Seed ALL products at 0 so they always appear in charts
  const byProduct = {};
  for (const label of Object.values(PRODUCT_MAP)) byProduct[label] = 0;

  const byHourIST = {}; // IST hour 0..23
  for (let h = 0; h < 24; h++) byHourIST[String(h)] = 0;

  const byDay = {};        // YYYY-MM-DD (IST date)
  const byUser = {};       // phone → count of enquiries
  const uniqueUsers = new Set();
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // UTC+5:30

  for (const l of leads) {
    const ts = new Date(l.timestamp);
    const tsIST = new Date(isNaN(ts) ? Date.now() : ts.getTime() + IST_OFFSET_MS);

    const day = tsIST.toISOString().slice(0, 10);
    const hour = String(tsIST.getUTCHours()); // after adding IST offset, getUTCHours() = IST hour

    const phoneKey = l.phone_number || l.wa_id || "unknown";
    uniqueUsers.add(phoneKey);
    byUser[phoneKey] = (byUser[phoneKey] || 0) + 1;

    const productLabel = l.product_label || PRODUCT_MAP[l.product] || l.product || "unknown";
    byProduct[productLabel] = (byProduct[productLabel] || 0) + 1;

    byDay[day] = (byDay[day] || 0) + 1;
    byHourIST[hour] = (byHourIST[hour] || 0) + 1;
  }

  // Sort day keys chronologically
  const byDaySorted = Object.fromEntries(
    Object.entries(byDay).sort((a, b) => a[0].localeCompare(b[0]))
  );

  // Repeat-enquiry breakdown: { "1 enquiry": N, "2+ enquiries": M }
  const singleEnquiry = Object.values(byUser).filter(n => n === 1).length;
  const repeatEnquiry = Object.values(byUser).filter(n => n > 1).length;

  return {
    totalLeads,
    uniqueUsers: uniqueUsers.size,
    byProduct,
    byHourIST,
    byDay: byDaySorted,
    byUser,                          // phone → count
    repeatStats: { singleEnquiry, repeatEnquiry },
    updatedAt: new Date().toISOString(),
  };
}

/* ================= ANALYTICS API ================= */
app.get("/analytics", (req, res) => {
  const leads = readLeadsFromCsv();
  const analytics = computeAnalytics(leads);
  return res.json(analytics);
});

/* ================= DASHBOARD (HTML) ================= */
app.get("/dashboard", (req, res) => {
  // Read raw leads for the table
  const leads = readLeadsFromCsv();
  const recent = [...leads].reverse().slice(0, 50);
  const recentJson = JSON.stringify(recent);

  res.setHeader("Content-Type", "text/html");
  res.send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>Finfinity – Lead Analytics</title>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet"/>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: #080e1a;
      --surface: #0f1829;
      --surface2: #141f35;
      --border: rgba(99,130,206,0.15);
      --accent: #4f8ef7;
      --accent2: #a78bfa;
      --accent3: #34d399;
      --text: #e2eafc;
      --muted: #6b80a8;
      --danger: #f87171;
      --warn: #fbbf24;
    }

    body {
      font-family: 'Inter', system-ui, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
    }

    /* ── HEADER ── */
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 20px 32px;
      border-bottom: 1px solid var(--border);
      background: rgba(15,24,41,0.8);
      backdrop-filter: blur(12px);
      position: sticky; top: 0; z-index: 10;
    }
    .logo { display: flex; align-items: center; gap: 10px; }
    .logo-icon {
      width: 36px; height: 36px; border-radius: 10px;
      background: linear-gradient(135deg, #4f8ef7 0%, #a78bfa 100%);
      display: flex; align-items: center; justify-content: center;
      font-size: 18px;
    }
    .logo-text { font-size: 18px; font-weight: 700; }
    .logo-sub { font-size: 11px; color: var(--muted); font-weight: 500; letter-spacing: .04em; text-transform: uppercase; }
    .header-right { display: flex; align-items: center; gap: 12px; }
    .refresh-dot {
      width: 8px; height: 8px; border-radius: 50%; background: var(--accent3);
      box-shadow: 0 0 0 0 rgba(52,211,153,.6);
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%   { box-shadow: 0 0 0 0 rgba(52,211,153,.6); }
      70%  { box-shadow: 0 0 0 8px rgba(52,211,153,0); }
      100% { box-shadow: 0 0 0 0 rgba(52,211,153,0); }
    }
    .refresh-label { font-size: 12px; color: var(--muted); }
    .btn-raw {
      font-size: 12px; color: var(--accent); text-decoration: none;
      border: 1px solid rgba(79,142,247,.3); border-radius: 8px;
      padding: 6px 12px; transition: background .2s;
    }
    .btn-raw:hover { background: rgba(79,142,247,.1); }

    /* ── LAYOUT ── */
    main { padding: 28px 32px; max-width: 1400px; margin: 0 auto; }
    .section-title { font-size: 11px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .08em; margin-bottom: 14px; }

    /* ── KPI GRID ── */
    .kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px,1fr)); gap: 16px; margin-bottom: 28px; }
    .kpi-card {
      border-radius: 16px; padding: 20px 22px;
      border: 1px solid var(--border);
      background: var(--surface);
      position: relative; overflow: hidden;
      transition: transform .2s, box-shadow .2s;
    }
    .kpi-card:hover { transform: translateY(-2px); box-shadow: 0 8px 32px rgba(0,0,0,.4); }
    .kpi-card::before {
      content: ''; position: absolute;
      top: -40px; right: -40px;
      width: 120px; height: 120px;
      border-radius: 50%;
      opacity: .08;
    }
    .kpi-card.blue::before  { background: #4f8ef7; }
    .kpi-card.purple::before{ background: #a78bfa; }
    .kpi-card.green::before { background: #34d399; }
    .kpi-card.orange::before{ background: #fb923c; }
    .kpi-icon { font-size: 20px; margin-bottom: 10px; }
    .kpi-value { font-size: 34px; font-weight: 800; line-height: 1; }
    .kpi-label { font-size: 12px; color: var(--muted); margin-top: 6px; font-weight: 500; }

    /* ── CHARTS GRID ── */
    .charts-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 28px; }
    .chart-card {
      border-radius: 16px; padding: 20px;
      border: 1px solid var(--border);
      background: var(--surface);
    }
    .chart-card.full { grid-column: 1 / -1; }
    .chart-card canvas { height: 260px !important; }
    .chart-card.full canvas { height: 200px !important; }
    .chart-title { font-size: 13px; font-weight: 600; margin-bottom: 2px; color: var(--text); }
    .chart-sub { font-size: 11px; color: var(--muted); margin-bottom: 14px; }
    .ist-badge { font-size: 10px; font-weight: 700; background: rgba(79,142,247,.15); color: var(--accent); padding: 2px 6px; border-radius: 4px; vertical-align: middle; margin-left: 6px; }

    /* ── TABLE ── */
    .table-card {
      border-radius: 16px; border: 1px solid var(--border);
      background: var(--surface); overflow: hidden; margin-bottom: 28px;
    }
    .table-header { padding: 16px 20px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; }
    .table-header h3 { font-size: 13px; font-weight: 600; }
    .badge { background: rgba(79,142,247,.15); color: var(--accent); font-size: 11px; font-weight: 600; padding: 3px 8px; border-radius: 20px; }
    table { width: 100%; border-collapse: collapse; }
    thead tr { background: rgba(20,31,53,1); }
    th { font-size: 11px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; padding: 10px 16px; text-align: left; }
    td { font-size: 13px; padding: 11px 16px; border-top: 1px solid var(--border); }
    tbody tr { transition: background .15s; }
    tbody tr:hover { background: rgba(255,255,255,.03); }

    /* product pills */
    .pill {
      display: inline-flex; align-items: center; gap: 5px;
      font-size: 11px; font-weight: 600; padding: 3px 9px;
      border-radius: 20px;
    }
    .pill.edu    { background: rgba(79,142,247,.15); color: #7eb3ff; }
    .pill.home   { background: rgba(52,211,153,.15); color: #5be4ac; }
    .pill.pers   { background: rgba(167,139,250,.15); color: #c4b0ff; }
    .pill.unknown{ background: rgba(107,128,168,.15); color: var(--muted); }

    .ts { color: var(--muted); font-size: 12px; }
    .phone-num { font-family: monospace; font-size: 12px; background: rgba(255,255,255,.05); padding: 2px 6px; border-radius: 6px; }

    /* ── FOOTER ── */
    footer { text-align: center; font-size: 11px; color: var(--muted); padding: 16px 0 28px; }

    @media (max-width: 768px) {
      header { padding: 14px 16px; }
      main { padding: 20px 16px; }
      .charts-grid { grid-template-columns: 1fr; }
      .chart-card.full { grid-column: 1; }
    }
  </style>
</head>
<body>
<header>
  <div class="logo">
    <div class="logo-icon">💬</div>
    <div>
      <div class="logo-text">Finfinity</div>
      <div class="logo-sub">WhatsApp Lead Analytics</div>
    </div>
  </div>
  <div class="header-right">
    <div class="refresh-dot"></div>
    <span class="refresh-label">Live · 15s refresh</span>
    <a href="/analytics" target="_blank" class="btn-raw">Raw JSON ↗</a>
  </div>
</header>

<main>
  <!-- KPI CARDS -->
  <div class="section-title">Overview</div>
  <div class="kpi-grid">
    <div class="kpi-card blue">
      <div class="kpi-icon">📋</div>
      <div class="kpi-value" id="kpiTotal">—</div>
      <div class="kpi-label">Total Leads</div>
    </div>
    <div class="kpi-card purple">
      <div class="kpi-icon">👥</div>
      <div class="kpi-value" id="kpiUsers">—</div>
      <div class="kpi-label">Unique Users</div>
    </div>
    <div class="kpi-card green">
      <div class="kpi-icon">🏆</div>
      <div class="kpi-value" id="kpiTopShort">—</div>
      <div class="kpi-label" id="kpiTopLabel">Top Product</div>
    </div>
    <div class="kpi-card orange">
      <div class="kpi-icon">🕐</div>
      <div class="kpi-value" id="kpiUpdated" style="font-size:14px;font-weight:600;margin-top:4px;">—</div>
      <div class="kpi-label">Last Updated (IST)</div>
    </div>
  </div>

  <!-- CHARTS -->
  <div class="section-title">Trends</div>
  <div class="charts-grid">
    <div class="chart-card">
      <div class="chart-title">Product Interest Split</div>
      <div class="chart-sub">Which loan type users enquired about</div>
      <canvas id="chartProduct"></canvas>
    </div>
    <div class="chart-card">
      <div class="chart-title">New vs Returning Users</div>
      <div class="chart-sub">Users with single vs multiple enquiries</div>
      <canvas id="chartRepeat"></canvas>
    </div>
    <div class="chart-card full">
      <div class="chart-title">Peak Enquiry Hours <span class="ist-badge">IST</span></div>
      <div class="chart-sub">When users are most active (6 AM – 11 PM IST)</div>
      <canvas id="chartHour"></canvas>
    </div>
  </div>

  <!-- RECENT LEADS TABLE -->
  <div class="section-title">Recent Leads</div>
  <div class="table-card">
    <div class="table-header">
      <h3>Lead Log</h3>
      <span class="badge" id="tableCount">0 entries</span>
    </div>
    <div style="overflow-x:auto;">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Timestamp (IST)</th>
            <th>Phone</th>
            <th>Product</th>
          </tr>
        </thead>
        <tbody id="leadsBody"></tbody>
      </table>
    </div>
  </div>
</main>

<footer>Finfinity WhatsApp Bot • Data from leads.csv • Auto-refresh every 15s</footer>

<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<script>
  let productChart, repeatChart, hourChart;
  const INITIAL_LEADS = ${recentJson};

  // ── Helpers ──
  function toIST(isoStr) {
    if (!isoStr) return '—';
    const d = new Date(isoStr);
    if (isNaN(d)) return isoStr;
    return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
  }

  function pillClass(product) {
    if (!product) return 'unknown';
    const p = product.toUpperCase();
    if (p.includes('EDU'))  return 'edu';
    if (p.includes('HOME')) return 'home';
    if (p.includes('PERS')) return 'pers';
    return 'unknown';
  }

  function pillLabel(lead) {
    return lead.product_label || lead.product || '—';
  }

  function buildTable(leads) {
    const tbody = document.getElementById('leadsBody');
    const count = document.getElementById('tableCount');
    count.textContent = leads.length + ' entries';
    tbody.innerHTML = leads.map((l, i) => \`
      <tr>
        <td style="color:var(--muted)">\${i + 1}</td>
        <td class="ts">\${toIST(l.timestamp)}</td>
        <td><span class="phone-num">\${l.phone_number || l.wa_id || '—'}</span></td>
        <td><span class="pill \${pillClass(l.product)}">\${pillLabel(l)}</span></td>
      </tr>
    \`).join('');
  }

  // ── Shared tooltip style ──
  const TOOLTIP = {
    backgroundColor: '#141f35',
    borderColor: 'rgba(99,130,206,0.25)',
    borderWidth: 1,
    titleColor: '#e2eafc',
    bodyColor: '#9fb2d9',
    padding: 10,
    cornerRadius: 8,
  };
  const GRID_COLOR = 'rgba(99,130,206,0.08)';
  const TICK_STYLE = { color: '#6b80a8', font: { size: 11 } };

  // ── 1. Product Doughnut ──
  function buildProductChart(labels, values) {
    const PROD_COLORS = ['#4f8ef7','#34d399','#a78bfa'];
    const cfg = {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: PROD_COLORS.map(c => c + 'cc'),
          borderColor: PROD_COLORS,
          borderWidth: 2,
          hoverOffset: 6,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        cutout: '65%',
        plugins: {
          legend: {
            display: true, position: 'bottom',
            labels: { color: '#9fb2d9', boxWidth: 12, padding: 16, font: { size: 12 } }
          },
          tooltip: { ...TOOLTIP, callbacks: {
            label: ctx => \` \${ctx.label}: \${ctx.parsed} leads\`
          }}
        }
      }
    };
    if (!productChart) {
      productChart = new Chart(document.getElementById('chartProduct'), cfg);
    } else {
      productChart.data.labels = labels;
      productChart.data.datasets[0].data = values;
      productChart.update();
    }
  }

  // ── 2. Repeat Users Doughnut ──
  function buildRepeatChart(single, repeat) {
    const cfg = {
      type: 'doughnut',
      data: {
        labels: ['First-time (1 enquiry)', 'Returning (2+ enquiries)'],
        datasets: [{
          data: [single, repeat],
          backgroundColor: ['#4f8ef7cc','#fb923ccc'],
          borderColor: ['#4f8ef7','#fb923c'],
          borderWidth: 2,
          hoverOffset: 6,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        cutout: '65%',
        plugins: {
          legend: {
            display: true, position: 'bottom',
            labels: { color: '#9fb2d9', boxWidth: 12, padding: 16, font: { size: 12 } }
          },
          tooltip: { ...TOOLTIP, callbacks: {
            label: ctx => \` \${ctx.label}: \${ctx.parsed} users\`
          }}
        }
      }
    };
    if (!repeatChart) {
      repeatChart = new Chart(document.getElementById('chartRepeat'), cfg);
    } else {
      repeatChart.data.datasets[0].data = [single, repeat];
      repeatChart.update();
    }
  }

  // ── 3. Peak Hours Bar (IST, 6am–11pm only) ──
  function buildHourChart(byHourIST) {
    // Only show 6:00 to 23:00 IST to avoid wall of zeroes
    const startH = 6, endH = 23;
    const labels = [], values = [];
    for (let h = startH; h <= endH; h++) {
      const ampm = h < 12 ? \`\${h === 0 ? 12 : h} AM\` : (h === 12 ? '12 PM' : \`\${h-12} PM\`);
      labels.push(ampm);
      values.push(byHourIST[String(h)] || 0);
    }
    const max    = Math.max(...values, 1);
    const grad_c = document.getElementById('chartHour').getContext('2d');
    const grad   = grad_c.createLinearGradient(0, 0, 0, 200);
    grad.addColorStop(0, 'rgba(79,142,247,0.9)');
    grad.addColorStop(1, 'rgba(79,142,247,0.2)');
    const cfg = {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Leads',
          data: values,
          backgroundColor: grad,
          borderColor: '#4f8ef7',
          borderWidth: 1,
          borderRadius: 6,
          borderSkipped: false,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { ...TOOLTIP } },
        scales: {
          x: { grid: { color: GRID_COLOR }, ticks: TICK_STYLE },
          y: { grid: { color: GRID_COLOR }, ticks: { ...TICK_STYLE, stepSize: 1 }, beginAtZero: true, max: max + 1 }
        }
      }
    };
    if (!hourChart) {
      hourChart = new Chart(document.getElementById('chartHour'), cfg);
    } else {
      hourChart.data.labels = labels;
      hourChart.data.datasets[0].data = values;
      hourChart.update();
    }
  }

  // ── Load & refresh ──
  async function load() {
    try {
      const res  = await fetch('/analytics');
      const data = await res.json();

      document.getElementById('kpiTotal').textContent = data.totalLeads;
      document.getElementById('kpiUsers').textContent = data.uniqueUsers;

      const entries = Object.entries(data.byProduct || {}).sort((a,b) => b[1]-a[1]);
      // Top product = first entry with > 0 leads, else first entry
      const topEntry = entries.find(e => e[1] > 0) || entries[0];
      if (topEntry) {
        document.getElementById('kpiTopShort').textContent = topEntry[0].replace(' Loan','');
        document.getElementById('kpiTopLabel').textContent = topEntry[1] + ' leads · Top Product';
      }

      document.getElementById('kpiUpdated').textContent = toIST(data.updatedAt);

      // ① Product doughnut — all 3 products always shown
      const pLabels = entries.map(e => e[0]);
      const pValues = entries.map(e => e[1]);
      buildProductChart(pLabels, pValues);

      // ② Repeat users doughnut
      const rs = data.repeatStats || { singleEnquiry: 0, repeatEnquiry: 0 };
      buildRepeatChart(rs.singleEnquiry, rs.repeatEnquiry);

      // ③ Peak hours IST bar
      buildHourChart(data.byHourIST || {});

    } catch(e) { console.error('Analytics fetch error', e); }
  }

  // Initial render with server-side data (no flicker)
  buildTable(INITIAL_LEADS);
  load();
  setInterval(load, 15000);
</script>
</body>
</html>`);
});

/* ================= START ================= */
app.listen(PORT, () => {
  console.log(`🚀 Webhook server running on http://localhost:${PORT}`);
  console.log(`📊 Dashboard available at /dashboard`);
});
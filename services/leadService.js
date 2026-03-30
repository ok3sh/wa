const fs = require("fs");

const { CSV_FILE, PRODUCT_MAP } = require("../config");
const logger = require("../utils/logger");

const CSV_HEADER = "timestamp,phone_number,wa_id,product,product_label,message_id\n";

// Create the CSV lazily so first deployment works even on an empty volume.
function ensureCsvFile() {
  if (!fs.existsSync(CSV_FILE)) {
    fs.writeFileSync(CSV_FILE, CSV_HEADER, "utf8");
  }
}

function logLead({ phone, wa_id, product, productLabel, messageId }) {
  const timestamp = new Date().toISOString();
  // Minimal CSV escaping to preserve commas/quotes in values.
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
    if (err) {
      logger.error("csv_write_error", { error: err.message, phone, product });
      return;
    }
    logger.info("lead_logged", { phone, product });
  });
}

async function readLeadsFromCsv() {
  if (!fs.existsSync(CSV_FILE)) return [];

  const raw = (await fs.promises.readFile(CSV_FILE, "utf8")).trim();
  if (!raw) return [];

  const lines = raw.split("\n");
  // Supports both the current header-based CSV and older rows without headers.
  const startIdx = lines[0].includes("timestamp") ? 1 : 0;

  const leads = [];

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const quotedFields = line.match(/"([^"]|"")*"/g);

    if (quotedFields && quotedFields.length >= 3) {
      const unq = (q) => q.slice(1, -1).replace(/""/g, '"');
      const fields = quotedFields.map(unq);

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
    }

    const parts = line.split(",");
    if (parts.length < 3) continue;

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

  return leads;
}

function computeAnalytics(leads) {
  const totalLeads = leads.length;
  const byProduct = {};

  // Seed charts so products always appear even when count is zero.
  for (const label of Object.values(PRODUCT_MAP)) byProduct[label] = 0;

  const byHourIST = {};
  for (let h = 0; h < 24; h++) byHourIST[String(h)] = 0;

  const byDay = {};
  const byUser = {};
  const uniqueUsers = new Set();
  // Compute time trends in IST to align with business reporting.
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

  for (const lead of leads) {
    const ts = new Date(lead.timestamp);
    const tsIST = new Date(isNaN(ts) ? Date.now() : ts.getTime() + IST_OFFSET_MS);

    const day = tsIST.toISOString().slice(0, 10);
    const hour = String(tsIST.getUTCHours());

    const phoneKey = lead.phone_number || lead.wa_id || "unknown";
    uniqueUsers.add(phoneKey);
    byUser[phoneKey] = (byUser[phoneKey] || 0) + 1;

    const productLabel = lead.product_label || PRODUCT_MAP[lead.product] || lead.product || "unknown";
    byProduct[productLabel] = (byProduct[productLabel] || 0) + 1;

    byDay[day] = (byDay[day] || 0) + 1;
    byHourIST[hour] = (byHourIST[hour] || 0) + 1;
  }

  const byDaySorted = Object.fromEntries(
    Object.entries(byDay).sort((a, b) => a[0].localeCompare(b[0]))
  );

  const singleEnquiry = Object.values(byUser).filter((n) => n === 1).length;
  const repeatEnquiry = Object.values(byUser).filter((n) => n > 1).length;

  return {
    totalLeads,
    uniqueUsers: uniqueUsers.size,
    byProduct,
    byHourIST,
    byDay: byDaySorted,
    byUser,
    repeatStats: { singleEnquiry, repeatEnquiry },
    updatedAt: new Date().toISOString(),
  };
}

// Note: readLeadsFromCsv is async — callers must await it.
module.exports = {
  ensureCsvFile,
  logLead,
  readLeadsFromCsv,
  computeAnalytics,
};

const { Pool } = require("pg");

const {
  POSTGRES_HOST,
  POSTGRES_PORT,
  POSTGRES_DB,
  POSTGRES_USER,
  POSTGRES_PASSWORD,
  POSTGRES_SSL,
  POSTGRES_POOL_MAX,
} = require("../config");

let pool;
let initPromise;

function isConfigured() {
  return Boolean(POSTGRES_HOST && POSTGRES_DB && POSTGRES_USER && POSTGRES_PASSWORD);
}

function getPool() {
  if (pool) return pool;

  pool = new Pool({
    host: POSTGRES_HOST,
    port: POSTGRES_PORT,
    database: POSTGRES_DB,
    user: POSTGRES_USER,
    password: POSTGRES_PASSWORD,
    max: POSTGRES_POOL_MAX,
    ssl: POSTGRES_SSL ? { rejectUnauthorized: false } : false,
  });

  return pool;
}

async function init() {
  if (!isConfigured()) {
    throw new Error("Postgres is not configured. Set POSTGRES_HOST, POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD.");
  }

  if (initPromise) return initPromise;

  initPromise = (async () => {
    const db = getPool();
    await db.query(`
      CREATE TABLE IF NOT EXISTS leads (
        id BIGSERIAL PRIMARY KEY,
        occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        phone_number TEXT,
        wa_id TEXT,
        product TEXT,
        product_label TEXT,
        message_id TEXT
      );
    `);
    await db.query("CREATE INDEX IF NOT EXISTS idx_leads_occurred_at ON leads (occurred_at DESC);");
    await db.query("CREATE INDEX IF NOT EXISTS idx_leads_phone_number ON leads (phone_number);");
  })();

  return initPromise;
}

async function insertLead({ timestamp, phone, wa_id, product, productLabel, messageId }) {
  await init();
  const db = getPool();

  await db.query(
    `
      INSERT INTO leads (occurred_at, phone_number, wa_id, product, product_label, message_id)
      VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [timestamp || new Date().toISOString(), phone || null, wa_id || null, product || null, productLabel || null, messageId || null]
  );
}

async function readLeads() {
  await init();
  const db = getPool();

  const { rows } = await db.query(
    `
      SELECT occurred_at, phone_number, wa_id, product, product_label, message_id
      FROM leads
      ORDER BY occurred_at ASC
    `
  );

  return rows.map((row) => ({
    timestamp: new Date(row.occurred_at).toISOString(),
    phone_number: row.phone_number || "",
    wa_id: row.wa_id || "",
    product: row.product || "",
    product_label: row.product_label || "",
    message_id: row.message_id || "",
  }));
}

module.exports = {
  isConfigured,
  init,
  insertLead,
  readLeads,
};

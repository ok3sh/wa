const express = require("express");
const path = require("path");

const { LOGO_FILE } = require("../config");
const { readLeadsFromCsv, computeAnalytics } = require("../services/leadService");
const adminAuth = require("../middleware/adminAuth");

const router = express.Router();

router.get("/", (req, res) => res.send("OK"));

router.get("/ping", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

router.get("/logo", (req, res) => {
  res.setHeader("Content-Type", "image/jpeg");
  res.sendFile(LOGO_FILE);
});

router.get("/analytics", adminAuth, async (req, res) => {
  const leads = await readLeadsFromCsv();
  const analytics = computeAnalytics(leads);
  res.json(analytics);
});

router.get("/api/leads/recent", adminAuth, async (req, res) => {
  const limitRaw = Number(req.query.limit || 50);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 500)) : 50;

  const leads = await readLeadsFromCsv();
  const recent = leads.slice().reverse().slice(0, limit);
  res.json(recent);
});

router.get("/dashboard", adminAuth, (req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "dashboard.html"));
});

module.exports = router;

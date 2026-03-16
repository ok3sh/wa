const express = require("express");
const path = require("path");

const { LOGO_FILE } = require("../config");
const { readLeadsFromCsv, computeAnalytics } = require("../services/leadService");

const router = express.Router();

router.get("/", (req, res) => res.send("OK"));

router.get("/ping", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

router.get("/logo", (req, res) => {
  res.setHeader("Content-Type", "image/jpeg");
  res.sendFile(LOGO_FILE);
});

router.get("/analytics", (req, res) => {
  const leads = readLeadsFromCsv();
  const analytics = computeAnalytics(leads);
  res.json(analytics);
});

router.get("/api/leads/recent", (req, res) => {
  const limitRaw = Number(req.query.limit || 50);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 500)) : 50;

  const leads = readLeadsFromCsv();
  const recent = leads.reverse().slice(0, limit);
  res.json(recent);
});

router.get("/dashboard", (req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "dashboard.html"));
});

module.exports = router;

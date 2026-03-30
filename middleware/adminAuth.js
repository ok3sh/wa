const crypto = require("crypto");

const DASHBOARD_USER = process.env.DASHBOARD_USER;
const DASHBOARD_PASS = process.env.DASHBOARD_PASS;

function safeCompare(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * HTTP Basic Auth guard for admin routes (/dashboard, /analytics, /api/leads/recent).
 * Browsers show a native login/password dialog automatically.
 * Set DASHBOARD_USER and DASHBOARD_PASS in your environment/.env file.
 *
 * If either env var is missing the route returns 503 rather than being silently open.
 */
function adminAuth(req, res, next) {
  if (!DASHBOARD_USER || !DASHBOARD_PASS) {
    return res.status(503).json({
      ok: false,
      error:
        "Admin access is not configured. Set DASHBOARD_USER and DASHBOARD_PASS environment variables.",
    });
  }

  const authHeader = req.get("Authorization");

  if (!authHeader?.startsWith("Basic ")) {
    res.set("WWW-Authenticate", 'Basic realm="Finfinity Dashboard"');
    return res.status(401).send("Unauthorized");
  }

  const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf8");
  const colonIdx = decoded.indexOf(":");
  if (colonIdx === -1) {
    res.set("WWW-Authenticate", 'Basic realm="Finfinity Dashboard"');
    return res.status(401).send("Unauthorized");
  }

  const user = decoded.slice(0, colonIdx);
  const pass = decoded.slice(colonIdx + 1);

  if (!safeCompare(user, DASHBOARD_USER) || !safeCompare(pass, DASHBOARD_PASS)) {
    res.set("WWW-Authenticate", 'Basic realm="Finfinity Dashboard"');
    return res.status(401).send("Unauthorized");
  }

  next();
}

module.exports = adminAuth;

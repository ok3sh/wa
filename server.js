require("dotenv").config();

const express = require("express");

const { PORT, validateEnv } = require("./config");
const { ensureLeadStore } = require("./services/leadService");
const { startCleanupJobs } = require("./services/sessionService");
const requestContext = require("./middleware/requestContext");
const { requestLogger, info, error: logError } = require("./utils/logger");
const { notFoundHandler, errorHandler } = require("./middleware/errorHandler");
const webhookRoutes = require("./routes/webhookRoutes");
const systemRoutes = require("./routes/systemRoutes");

// Validate startup prerequisites and initialize local state stores.
validateEnv();
startCleanupJobs();

const app = express();

// Trust the X-Forwarded-For header from reverse proxy (nginx, load balancer, etc.)
// Required for express-rate-limit to work correctly in production.
app.set('trust proxy', 1);

// Keep rawBody for optional Meta signature checks while parsing JSON normally.
app.use(
  express.json({
    limit: "2mb",
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(requestContext);
app.use(requestLogger);

// Register functional routes first, then fall through to 404 and global error handling.
app.use(systemRoutes);
app.use(webhookRoutes);
app.use(notFoundHandler);
app.use(errorHandler);

let server;

async function startServer() {
  await ensureLeadStore();

  server = app.listen(PORT, () => {
    info("server_started", { port: PORT });
    console.log(`Webhook server running on http://localhost:${PORT}`);
    console.log("Dashboard available at /dashboard");
  });

  server.on("error", (err) => {
    logError("server_listen_error", { error: err.message, code: err.code });
    process.exit(1);
  });
}

startServer().catch((err) => {
  logError("server_startup_failed", { error: err.message });
  process.exit(1);
});

// Graceful shutdown — finish in-flight requests before exiting so that
// leads aren't dropped mid-write during rolling deploys or container stops.
function shutdown(signal) {
  info("shutdown_initiated", { signal });
  if (!server) {
    process.exit(0);
    return;
  }

  server.close(() => {
    info("server_closed");
    process.exit(0);
  });

  // Hard kill after 10 s if connections haven't drained.
  setTimeout(() => {
    logError("shutdown_timeout", { signal });
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
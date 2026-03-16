require("dotenv").config();

const express = require("express");

const { PORT, validateEnv } = require("./config");
const { ensureCsvFile } = require("./services/leadService");
const { startCleanupJobs } = require("./services/sessionService");
const requestContext = require("./middleware/requestContext");
const { requestLogger } = require("./utils/logger");
const { notFoundHandler, errorHandler } = require("./middleware/errorHandler");
const webhookRoutes = require("./routes/webhookRoutes");
const systemRoutes = require("./routes/systemRoutes");

// Validate startup prerequisites and initialize local state stores.
validateEnv();
ensureCsvFile();
startCleanupJobs();

const app = express();

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

app.listen(PORT, () => {
  console.log(`Webhook server running on http://localhost:${PORT}`);
  console.log("Dashboard available at /dashboard");
});
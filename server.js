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

validateEnv();
ensureCsvFile();
startCleanupJobs();

const app = express();

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

app.use(systemRoutes);
app.use(webhookRoutes);
app.use(notFoundHandler);
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Webhook server running on http://localhost:${PORT}`);
  console.log("Dashboard available at /dashboard");
});
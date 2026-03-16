require("dotenv").config();

const express = require("express");

const { PORT, validateEnv } = require("./config");
const { ensureCsvFile } = require("./services/leadService");
const { startCleanupJobs } = require("./services/sessionService");
const webhookRoutes = require("./routes/webhookRoutes");
const systemRoutes = require("./routes/systemRoutes");

validateEnv();
ensureCsvFile();
startCleanupJobs();

const app = express();

app.use(express.json({ limit: "2mb" }));
app.use((req, res, next) => {
  console.log(`REQ: ${req.method} ${req.url}`);
  next();
});

app.use(systemRoutes);
app.use(webhookRoutes);

app.listen(PORT, () => {
  console.log(`Webhook server running on http://localhost:${PORT}`);
  console.log("Dashboard available at /dashboard");
});
const fs = require("fs");
const path = require("path");

const LOG_DIR = process.env.LOG_DIR || path.join(process.cwd(), "logs");
const LOG_TO_FILE = String(process.env.LOG_TO_FILE || "true").toLowerCase() === "true";

let logDirReady = false;

function ensureLogDir() {
  if (!LOG_TO_FILE || logDirReady) return;

  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    logDirReady = true;
  } catch (err) {
    logDirReady = false;
    console.warn(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "warn",
        message: "file_logging_disabled",
        error: err.message,
        logDir: LOG_DIR,
      })
    );
  }
}

function appendToLogFiles(level, line) {
  if (!LOG_TO_FILE) return;
  ensureLogDir();
  if (!logDirReady) return;

  fs.appendFile(path.join(LOG_DIR, "app.log"), `${line}\n`, () => {});
  if (level === "error") {
    fs.appendFile(path.join(LOG_DIR, "error.log"), `${line}\n`, () => {});
  }
}

function log(level, message, meta = {}) {
  // JSON logs are easier to search/filter in production log aggregators.
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    ...meta,
  };

  const line = JSON.stringify(entry);
  appendToLogFiles(level, line);

  if (level === "error") {
    console.error(line);
    return;
  }

  if (level === "warn") {
    console.warn(line);
    return;
  }

  console.log(line);
}

function info(message, meta) {
  log("info", message, meta);
}

function warn(message, meta) {
  log("warn", message, meta);
}

function error(message, meta) {
  log("error", message, meta);
}

function requestLogger(req, res, next) {
  const start = Date.now();

  // Emit one request summary line after response completion.
  res.on("finish", () => {
    info("http_request", {
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Date.now() - start,
    });
  });

  next();
}

module.exports = {
  info,
  warn,
  error,
  requestLogger,
};

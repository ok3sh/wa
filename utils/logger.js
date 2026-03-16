function log(level, message, meta = {}) {
  // JSON logs are easier to search/filter in production log aggregators.
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    ...meta,
  };

  const line = JSON.stringify(entry);
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

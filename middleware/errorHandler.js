const { error } = require("../utils/logger");

function notFoundHandler(req, res, next) {
  res.status(404).json({
    ok: false,
    error: "Not Found",
    requestId: req.requestId,
  });
}

function errorHandler(err, req, res, next) {
  error("unhandled_error", {
    requestId: req.requestId,
    message: err.message,
    stack: process.env.NODE_ENV === "production" ? undefined : err.stack,
  });

  if (res.headersSent) return;

  res.status(500).json({
    ok: false,
    error: "Internal Server Error",
    requestId: req.requestId,
  });
}

module.exports = {
  notFoundHandler,
  errorHandler,
};

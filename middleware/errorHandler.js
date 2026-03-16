const { error } = require("../utils/logger");

function notFoundHandler(req, res, next) {
  // Keep 404 responses consistent with API error shape.
  res.status(404).json({
    ok: false,
    error: "Not Found",
    requestId: req.requestId,
  });
}

function errorHandler(err, req, res, next) {
  // Log full diagnostic context, but only expose safe details to clients.
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

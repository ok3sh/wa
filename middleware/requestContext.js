const crypto = require("crypto");

function requestContext(req, res, next) {
  req.requestId = crypto.randomUUID();
  next();
}

module.exports = requestContext;

const { v4: uuidv4 } = require('uuid');

function requestIdMiddleware(req, res, next) {
  req.requestId = req.headers['x-request-id'] || uuidv4();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

module.exports = requestIdMiddleware;

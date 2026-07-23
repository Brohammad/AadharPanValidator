const logger = require('../logger');

function errorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal server error';

  logger.error(
    {
      requestId: req.requestId,
      err: { message: err.message, stack: err.stack },
    },
    'Request failed'
  );

  res.status(status).json({
    error: message,
    requestId: req.requestId,
  });
}

module.exports = errorHandler;

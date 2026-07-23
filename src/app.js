const express = require('express');
const path = require('path');
const pinoHttp = require('pino-http');
const requestIdMiddleware = require('./middleware/requestId');
const verifyRoutes = require('./routes/verify');
const errorHandler = require('./middleware/errorHandler');
const logger = require('./logger');

const app = express();

app.use(requestIdMiddleware);
app.use(
  pinoHttp({
    logger,
    customProps: (req) => ({ requestId: req.requestId }),
  })
);

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api', verifyRoutes);
app.use(errorHandler);

module.exports = app;

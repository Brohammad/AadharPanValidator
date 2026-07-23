const path = require('path');

module.exports = {
  port: parseInt(process.env.PORT || '3000', 10),
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE || String(10 * 1024 * 1024), 10),
  authScoreThreshold: parseInt(process.env.AUTH_SCORE_THRESHOLD || '70', 10),
  uploadDir: path.resolve(process.env.UPLOAD_DIR || 'uploads'),
  tempDir: path.resolve(process.env.TEMP_DIR || 'temp'),
  logLevel: process.env.LOG_LEVEL || 'info',
  allowedMimeTypes: ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'],
  allowedExtensions: ['.jpg', '.jpeg', '.png', '.pdf'],
  categoryWeights: {
    ocrQuality: 0.08,
    layoutMatch: 0.25,
    logoDetection: 0.20,
    validation: 0.18,
    tampering: 0.19,
    resolution: 0.10,
  },
  assetsDir: path.resolve('assets'),
};

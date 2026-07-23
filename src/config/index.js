const path = require('path');

module.exports = {
  port: parseInt(process.env.PORT || '3000', 10),
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE || String(10 * 1024 * 1024), 10),

  /** Minimum average OCR word confidence (0–100) to continue past OCR stage */
  ocrConfidenceThreshold: parseInt(process.env.OCR_CONFIDENCE_THRESHOLD || '40', 10),

  /** Minimum identify() score (0–100) for the requested document type */
  classificationThreshold: parseInt(
    process.env.CLASSIFICATION_THRESHOLD || process.env.IDENTIFY_THRESHOLD || '35',
    10
  ),

  /** Reject requested type when another type scores this many points higher */
  classificationMismatchMargin: parseInt(
    process.env.CLASSIFICATION_MISMATCH_MARGIN || '15',
    10
  ),

  /** Authenticity aggregate score threshold (0–100) */
  authScoreThreshold: parseInt(process.env.AUTH_SCORE_THRESHOLD || '70', 10),

  /** Soft blur Laplacian variance floor used in OCR quality gate */
  ocrBlurMin: parseFloat(process.env.OCR_BLUR_MIN || '40'),

  /** Minimum alphanumeric characters expected in OCR text */
  ocrMinAlnum: parseInt(process.env.OCR_MIN_ALNUM || '25', 10),

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

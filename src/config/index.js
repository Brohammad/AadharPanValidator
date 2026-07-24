const path = require('path');

const riskThreshold = parseInt(
  process.env.RISK_THRESHOLD || process.env.AUTH_SCORE_THRESHOLD || '70',
  10
);

module.exports = {
  port: parseInt(process.env.PORT || '3000', 10),
  maxFileSize: parseInt(
    process.env.MAX_UPLOAD_SIZE || process.env.MAX_FILE_SIZE || String(10 * 1024 * 1024),
    10
  ),

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

  /** Soft multi-signal floor: need this many distinct signals unless score is decisive */
  classificationMinSignals: parseInt(process.env.CLASSIFICATION_MIN_SIGNALS || '2', 10),
  classificationDecisiveScore: parseInt(process.env.CLASSIFICATION_DECISIVE_SCORE || '50', 10),

  /** Soft extraction confidence floor — warn when below (does not hard-stop) */
  extractionThreshold: parseInt(process.env.EXTRACTION_THRESHOLD || '45', 10),

  /** Risk / integrity aggregate score threshold (0–100) */
  riskThreshold,
  /** @deprecated Use riskThreshold */
  authScoreThreshold: riskThreshold,

  /** Soft blur Laplacian variance floor used in OCR quality gate */
  ocrBlurMin: parseFloat(process.env.OCR_BLUR_MIN || '40'),

  /** Minimum alphanumeric characters expected in OCR text */
  ocrMinAlnum: parseInt(process.env.OCR_MIN_ALNUM || '25', 10),

  /** Preprocess resize targets */
  ocrResizeWidthPhoto: parseInt(process.env.OCR_RESIZE_WIDTH_PHOTO || '1800', 10),
  ocrResizeWidthPdf: parseInt(process.env.OCR_RESIZE_WIDTH_PDF || '1600', 10),

  /** PDF rasterization DPI */
  pdfDpi: parseInt(process.env.PDF_DPI || '200', 10),

  /** Tesseract early-stop scores */
  ocrGoodEnoughScore: parseInt(process.env.OCR_GOOD_ENOUGH_SCORE || '140', 10),
  ocrExcellentScore: parseInt(process.env.OCR_EXCELLENT_SCORE || '200', 10),
  /** Fast-path override used by orchestrator */
  ocrFastGoodEnoughScore: parseInt(process.env.OCR_FAST_GOOD_ENOUGH_SCORE || '80', 10),

  /** Classification context signal weight adjustments */
  classification: {
    signalWeights: {
      highOcrConfidence: 5,
      lowOcrConfidence: -8,
      photoLayout: 3,
      qrLayout: 2,
      logoDetected: 8,
      cardAspect: 2,
    },
    highOcrConfidenceMin: 70,
    lowOcrConfidenceMax: 45,
  },

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

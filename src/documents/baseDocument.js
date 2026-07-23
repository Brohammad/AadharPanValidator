const config = require('../config');

class BaseDocument {
  /**
   * @param {string} type - Machine type key (e.g. AADHAAR, PASSPORT)
   * @param {string} label - Human label
   * @param {{ mode?: 'verification' | 'extraction' }} [options]
   */
  constructor(type, label, options = {}) {
    this.type = type;
    this.label = label;
    this.mode = options.mode || 'verification';
  }

  /**
   * Optional async OCR refinement (e.g. passport ROI passes).
   * @returns {Promise<object>} updated ocr result
   */
  async refineOcr(ocrResult, _page) {
    return ocrResult;
  }

  identify(_features, _ocr) {
    throw new Error('identify() must be implemented');
  }

  extract(_ocr) {
    throw new Error('extract() must be implemented');
  }

  /**
   * Format / checksum validation. Extraction-only docs use the default pass-through.
   */
  validate(_data) {
    return { passed: true, checks: {}, reason: null };
  }

  /**
   * Detector names for the authenticity rule engine.
   * Extraction-only documents return [].
   */
  authenticityChecks() {
    if (this.mode === 'extraction') return [];
    return [
      'layoutDetector',
      'logoDetector',
      'checksumValidator',
      'screenshotDetector',
      'blurDetector',
      'resolutionDetector',
      'fontDetector',
      'templateMatcher',
      'cropDetector',
      'typedTextDetector',
      'tamperingDetector',
    ];
  }

  /**
   * Apply validator-normalized ID into the correct data field.
   * Override in verification documents that normalize a primary ID.
   */
  normalizeData(data, validationResult) {
    return data;
  }

  /**
   * Build the API response for this document type.
   */
  buildResponse(ctx) {
    if (this.mode === 'extraction') {
      return {
        mode: 'extraction',
        documentType: this.type,
        ocrConfidence: ctx.ocrConfidence,
        extractionConfidence: ctx.extractionConfidence,
        extractionIssues: ctx.extractionIssues || [],
        data: ctx.data,
        fullOcrText: ctx.data?.fullOcrText || ctx.ocrText || '',
        timings: ctx.timings,
      };
    }

    return {
      mode: 'verification',
      documentType: this.type,
      ...ctx.decision,
      ocrConfidence: ctx.ocrConfidence,
      extractionConfidence: ctx.extractionConfidence,
      extractionIssues: ctx.extractionIssues,
      fraudIndicators: ctx.fraudIndicators,
      qualityWarnings: ctx.qualityWarnings || [],
      detectorResults: ctx.detectorResults,
      categoryScores: ctx.categoryScores,
      checks: ctx.checks,
      data: ctx.data,
      fullOcrText: ctx.data?.fullOcrText || ctx.ocrText || '',
      imageQuality: ctx.imageQuality,
      orientationAngle: ctx.orientationAngle,
      timings: ctx.timings,
    };
  }

  buildUnknownResponse(ctx) {
    return {
      mode: 'verification',
      documentType: 'UNKNOWN',
      validation: { passed: false, checks: {}, reason: 'Unknown document type' },
      authenticity: { passed: false, score: 0, threshold: config.authScoreThreshold },
      overallPassed: false,
      ocrConfidence: ctx.ocrConfidence,
      extractionConfidence: 0,
      extractionIssues: ['Document could not be classified'],
      fraudIndicators: ['Unknown document type'],
      detectorResults: [],
      categoryScores: {},
      data: {},
      fullOcrText: ctx.ocrText || '',
      imageQuality: ctx.imageQuality,
      rejectionReasons: [ctx.rejectionReason || 'Document type not recognized'],
      timings: ctx.timings,
    };
  }
}

module.exports = BaseDocument;

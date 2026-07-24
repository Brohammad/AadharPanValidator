const config = require('../config');

class BaseDocument {
  /**
   * @param {string} type - Machine type key (e.g. AADHAAR, PASSPORT)
   * @param {string} label - Human label
   * @param {{ mode?: 'verification' | 'extraction', supportsValidation?: boolean }} [options]
   */
  constructor(type, label, options = {}) {
    this.type = type;
    this.label = label;
    this.mode = options.mode || 'verification';
    this.supportsValidation = options.supportsValidation ?? this.mode === 'verification';
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
   * Format / checksum validation. Override when supportsValidation is true.
   */
  validate(_data) {
    return { passed: true, checks: {}, reasons: [], reason: null };
  }

  /**
   * Detector names for the risk / integrity rule engine.
   * Extraction-only documents return [].
   */
  riskChecks() {
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

  /** @deprecated Prefer riskChecks() */
  authenticityChecks() {
    return this.riskChecks();
  }

  /**
   * Apply validator-normalized ID into the correct data field.
   * Override in verification documents that normalize a primary ID.
   */
  normalizeData(data, validationResult) {
    return data;
  }

  /**
   * Legacy helper — live pipeline uses responseBuilder.
   */
  buildResponse(ctx) {
    if (this.mode === 'extraction') {
      return {
        mode: 'extraction',
        documentType: this.type,
        ocrConfidence: ctx.ocrConfidence,
        extractionConfidence: ctx.extractionConfidence,
        extractionIssues: ctx.extractionIssues || [],
        extractionReasons: ctx.extractionReasons || [],
        validation: ctx.validation || null,
        riskAssessment: null,
        authenticity: null,
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
      extractionReasons: ctx.extractionReasons || [],
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
      mode: this.mode || 'verification',
      documentType: 'UNKNOWN',
      validation: { passed: false, checks: {}, reason: 'Unknown document type' },
      riskAssessment: {
        overallScore: 0,
        threshold: config.riskThreshold,
        passed: false,
        indicators: ['Unknown document type'],
        reasoning: [
          {
            code: 'UNKNOWN_TYPE',
            message: 'Document type not recognized',
            stage: 'classification',
          },
        ],
      },
      authenticity: { passed: false, score: 0, threshold: config.riskThreshold },
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

const config = require('../config');

/**
 * Unified response builder for completed and early-stopped pipeline runs.
 */
function buildStoppedResponse({
  stage,
  reason,
  reasons = [],
  ocrConfidence = null,
  classification = null,
  imageQuality = null,
  timings = {},
  fullOcrText = '',
  qualityWarnings = [],
  orientationAngle = 0,
}) {
  const allReasons = reasons.length ? reasons : reason ? [reason] : [];

  return {
    stage,
    status: 'stopped',
    reason: reason || allReasons[0] || 'Processing stopped',
    reasons: allReasons,
    documentType: classification?.documentType || (stage === 'classification' ? 'UNKNOWN' : null),
    mode: null,
    ocrConfidence,
    classificationConfidence: classification?.classificationConfidence ?? null,
    classification: classification
      ? {
          requestedType: classification.requestedType,
          documentType: classification.documentType,
          confidence: classification.classificationConfidence,
          threshold: classification.threshold,
          reasons: classification.reasons,
          signals: classification.signals,
          allScores: classification.allScores,
          bestAlternative: classification.bestAlternative,
        }
      : null,
    extractionConfidence: 0,
    extractionIssues: [],
    qualityWarnings: [...new Set([...(qualityWarnings || []), ...allReasons])],
    data: fullOcrText ? { fullOcrText } : {},
    fullOcrText: fullOcrText || '',
    imageQuality,
    orientationAngle,
    timings,
    // Explicitly omit misleading verification fields
    validation: null,
    authenticity: null,
    overallPassed: false,
    fraudIndicators: [],
    detectorResults: [],
    categoryScores: {},
  };
}

function buildCompletedResponse({
  document,
  decision = null,
  ocrConfidence,
  extractionConfidence,
  extractionIssues = [],
  fraudIndicators = [],
  qualityWarnings = [],
  detectorResults = [],
  categoryScores = {},
  checks = {},
  data = {},
  fullOcrText = '',
  imageQuality = null,
  orientationAngle = 0,
  timings = {},
  classification = null,
}) {
  const base = {
    stage: 'complete',
    status: 'completed',
    reason: null,
    reasons: [],
    documentType: document.type,
    mode: document.mode,
    ocrConfidence,
    classificationConfidence: classification?.classificationConfidence ?? null,
    classification: classification
      ? {
          requestedType: classification.requestedType,
          documentType: classification.documentType,
          confidence: classification.classificationConfidence,
          threshold: classification.threshold,
          reasons: classification.reasons,
          signals: classification.signals,
          allScores: classification.allScores,
        }
      : null,
    extractionConfidence,
    extractionIssues,
    qualityWarnings,
    data,
    fullOcrText: data.fullOcrText || fullOcrText || '',
    imageQuality,
    orientationAngle,
    timings,
  };

  if (document.mode === 'extraction') {
    return {
      ...base,
      validation: null,
      authenticity: null,
      overallPassed: null,
      fraudIndicators: [],
      detectorResults: [],
      categoryScores: {},
      checks: {},
    };
  }

  return {
    ...base,
    ...(decision || {
      validation: { passed: false, checks: {} },
      authenticity: {
        passed: false,
        score: 0,
        threshold: config.authScoreThreshold,
      },
      overallPassed: false,
    }),
    fraudIndicators,
    detectorResults,
    categoryScores,
    checks,
  };
}

module.exports = { buildStoppedResponse, buildCompletedResponse };

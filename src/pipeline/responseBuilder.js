const config = require('../config');

/**
 * Unified response builder for completed and early-stopped pipeline runs.
 */

function normalizeReasons(reasons = [], reason = null, stage = null) {
  const list = [];
  for (const r of reasons.length ? reasons : reason ? [reason] : []) {
    if (r == null) continue;
    if (typeof r === 'string') {
      list.push({ code: 'REASON', message: r, stage: stage || undefined });
    } else if (typeof r === 'object' && r.message) {
      list.push({
        code: r.code || 'REASON',
        message: r.message,
        stage: r.stage || stage || undefined,
      });
    }
  }
  return list;
}

function reasonMessages(reasons) {
  return reasons.map((r) => (typeof r === 'string' ? r : r.message)).filter(Boolean);
}

function buildRiskAssessment({
  decision = null,
  aggregation = null,
  detectorResults = [],
  fraudIndicators = [],
}) {
  if (!decision?.authenticity && !decision?.riskAssessment) return null;

  const auth = decision.riskAssessment || decision.authenticity;
  const indicators = fraudIndicators.length
    ? fraudIndicators
    : aggregation?.fraudIndicators || [];
  const reasoning = [];

  if (auth.passed) {
    reasoning.push({
      code: 'RISK_BELOW_THRESHOLD',
      message: `Integrity score ${auth.score} meets threshold ${auth.threshold}`,
      stage: 'risk',
    });
  } else {
    reasoning.push({
      code: 'RISK_ABOVE_THRESHOLD',
      message: `Integrity score ${auth.score} below threshold ${auth.threshold}`,
      stage: 'risk',
    });
  }
  for (const ind of indicators) {
    reasoning.push({
      code: 'INTEGRITY_INDICATOR',
      message: ind,
      stage: 'risk',
    });
  }

  return {
    overallScore: auth.score,
    threshold: auth.threshold,
    passed: auth.passed,
    indicators: [...indicators],
    reasoning,
    categoryScores: aggregation?.categoryScores || {},
    detectorResults,
  };
}

/**
 * @param {object} opts
 * @param {string} [opts.mode] - Document mode when known (stopped responses)
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
  mode = null,
}) {
  const structured = normalizeReasons(reasons, reason, stage);
  const messages = reasonMessages(structured.length ? structured : reasons);
  const stopReason = reason || messages[0] || 'Processing stopped';

  return {
    stage,
    status: 'stopped',
    reason: stopReason,
    stopReason,
    reasons: structured.length ? structured : messages.map((m) => ({ code: 'REASON', message: m, stage })),
    documentType: classification?.documentType || (stage === 'classification' ? 'UNKNOWN' : null),
    mode,
    ocrConfidence,
    classificationConfidence: classification?.classificationConfidence ?? null,
    classification: classification
      ? {
          requestedType: classification.requestedType,
          documentType: classification.documentType,
          confidence: classification.classificationConfidence,
          threshold: classification.threshold,
          reasons: classification.reasons,
          reasoning: classification.reasoning || classification.reasons,
          signals: classification.signals,
          matchedSignals: classification.matchedSignals || classification.signals,
          allScores: classification.allScores,
          bestAlternative: classification.bestAlternative,
        }
      : null,
    extractionConfidence: 0,
    extractionReasons: [],
    extractionIssues: [],
    extractionBelowThreshold: false,
    qualityWarnings: [
      ...new Set([
        ...(qualityWarnings || []),
        ...messages,
      ]),
    ],
    warnings: [
      ...new Set([
        ...(qualityWarnings || []),
        ...messages,
      ]),
    ],
    data: fullOcrText ? { fullOcrText } : {},
    fullOcrText: fullOcrText || '',
    imageQuality,
    orientationAngle,
    timings,
    validation: null,
    riskAssessment: null,
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
  aggregation = null,
  ocrConfidence,
  extractionConfidence,
  extractionReasons = [],
  extractionIssues = [],
  extractionBelowThreshold = false,
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
  validationResult = null,
}) {
  const warnings = [...new Set([...(qualityWarnings || [])])];
  if (extractionBelowThreshold) {
    warnings.push(
      `Extraction confidence ${extractionConfidence}% below threshold ${config.extractionThreshold}%`
    );
  }

  const base = {
    stage: 'complete',
    status: 'completed',
    reason: null,
    stopReason: null,
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
          reasoning: classification.reasoning || classification.reasons,
          signals: classification.signals,
          matchedSignals: classification.matchedSignals || classification.signals,
          allScores: classification.allScores,
        }
      : null,
    extractionConfidence,
    extractionReasons,
    extractionIssues,
    extractionBelowThreshold,
    qualityWarnings: warnings,
    warnings,
    data,
    fullOcrText: data.fullOcrText || fullOcrText || '',
    imageQuality,
    orientationAngle,
    timings,
  };

  const validation =
    validationResult ||
    decision?.validation ||
    null;

  if (document.mode === 'extraction') {
    return {
      ...base,
      validation: validation || null,
      riskAssessment: null,
      authenticity: null,
      overallPassed: validation ? validation.passed : null,
      fraudIndicators: [],
      detectorResults: [],
      categoryScores: {},
      checks: validation?.checks || {},
    };
  }

  const riskAssessment = buildRiskAssessment({
    decision,
    aggregation,
    detectorResults,
    fraudIndicators,
  });

  const authenticity = decision?.authenticity ||
    (riskAssessment
      ? {
          passed: riskAssessment.passed,
          score: riskAssessment.overallScore,
          threshold: riskAssessment.threshold,
        }
      : {
          passed: false,
          score: 0,
          threshold: config.riskThreshold,
        });

  return {
    ...base,
    validation: validation || { passed: false, checks: {} },
    riskAssessment,
    authenticity,
    overallPassed: decision?.overallPassed ?? false,
    fraudIndicators,
    detectorResults,
    categoryScores,
    checks,
  };
}

module.exports = {
  buildStoppedResponse,
  buildCompletedResponse,
  buildRiskAssessment,
  normalizeReasons,
};

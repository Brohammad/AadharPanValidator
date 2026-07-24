const config = require('../config');

const DETECTOR_CATEGORIES = {
  ocrQualityDetector: 'ocrQuality',
  blurDetector: 'ocrQuality',
  layoutDetector: 'layoutMatch',
  templateMatcher: 'layoutMatch',
  cropDetector: 'layoutMatch',
  logoDetector: 'logoDetection',
  checksumValidator: 'validation',
  screenshotDetector: 'tampering',
  typedTextDetector: 'tampering',
  tamperingDetector: 'tampering',
  fontDetector: 'tampering',
  resolutionDetector: 'resolution',
};

/** Hard integrity signals that should always surface when they fail */
const HARD_FRAUD_DETECTORS = new Set([
  'typedTextDetector',
  'screenshotDetector',
  'layoutDetector',
  'logoDetector',
  'checksumValidator',
]);

/** Soft quality signals — advisory unless risk score fails badly */
const SOFT_QUALITY_DETECTORS = new Set([
  'fontDetector',
  'ocrQualityDetector',
  'blurDetector',
  'cropDetector',
  'resolutionDetector',
  'templateMatcher',
  'tamperingDetector',
]);

function aggregateScores(detectorResults) {
  const categoryTotals = {};
  const categoryWeights = {};

  for (const result of detectorResults) {
    const category = DETECTOR_CATEGORIES[result.name] || 'tampering';
    const weighted = result.score * result.weight;
    categoryTotals[category] = (categoryTotals[category] || 0) + weighted;
    categoryWeights[category] = (categoryWeights[category] || 0) + result.weight;
  }

  const categoryScores = {};
  for (const [category, total] of Object.entries(categoryTotals)) {
    const maxWeight = categoryWeights[category] || 1;
    categoryScores[category] = Math.round((total / maxWeight) * 100) / 100;
  }

  const weights = config.categoryWeights;
  let riskScore = 0;
  for (const [category, weight] of Object.entries(weights)) {
    const catScore = categoryScores[category] || 0;
    riskScore += catScore * weight * 100;
  }

  riskScore = Math.round(Math.min(100, Math.max(0, riskScore)));

  const typed = detectorResults.find((r) => r.name === 'typedTextDetector');
  const shot = detectorResults.find((r) => r.name === 'screenshotDetector');
  const logo = detectorResults.find((r) => r.name === 'logoDetector');
  const layout = detectorResults.find((r) => r.name === 'layoutDetector');

  if (typed && !typed.passed) {
    riskScore = Math.min(riskScore, 35);
  }
  if (shot && !shot.passed && shot.score < 0.45) {
    riskScore = Math.min(riskScore, 40);
  }
  if (logo && !logo.passed && layout && !layout.passed) {
    riskScore = Math.min(riskScore, 45);
  }

  if (typed && typed.score < 0.5) {
    riskScore = Math.min(riskScore, 35);
  }

  const riskPassed = riskScore >= config.riskThreshold;

  const fraudIndicators = [];
  const qualityWarnings = [];
  const reasoning = [];

  for (const r of detectorResults) {
    if (r.passed || !r.fraudMessage) continue;

    if (HARD_FRAUD_DETECTORS.has(r.name)) {
      fraudIndicators.push(r.fraudMessage);
      reasoning.push({
        code: `DETECTOR_${r.name.toUpperCase()}_FAIL`,
        message: r.fraudMessage,
        stage: 'risk',
      });
      continue;
    }

    if (SOFT_QUALITY_DETECTORS.has(r.name)) {
      if (!riskPassed && r.score < 0.35) {
        fraudIndicators.push(r.fraudMessage);
        reasoning.push({
          code: `DETECTOR_${r.name.toUpperCase()}_FAIL`,
          message: r.fraudMessage,
          stage: 'risk',
        });
      } else {
        qualityWarnings.push(r.fraudMessage);
        reasoning.push({
          code: `DETECTOR_${r.name.toUpperCase()}_WARN`,
          message: r.fraudMessage,
          stage: 'risk',
        });
      }
      continue;
    }

    if (!riskPassed) {
      fraudIndicators.push(r.fraudMessage);
      reasoning.push({
        code: `DETECTOR_${r.name.toUpperCase()}_FAIL`,
        message: r.fraudMessage,
        stage: 'risk',
      });
    } else {
      qualityWarnings.push(r.fraudMessage);
    }
  }

  const checks = {};
  for (const result of detectorResults) {
    checks[result.name] = result.passed;
  }

  return {
    /** Primary integrity score */
    riskScore,
    /** @deprecated Use riskScore */
    authenticityScore: riskScore,
    categoryScores,
    fraudIndicators: [...new Set(fraudIndicators)],
    qualityWarnings: [...new Set(qualityWarnings)],
    reasoning,
    checks,
  };
}

function buildDecision(validationResult, aggregation, threshold) {
  const riskThresh = threshold ?? config.riskThreshold;
  const score = aggregation.riskScore ?? aggregation.authenticityScore ?? 0;
  const passed = score >= riskThresh;

  return {
    validation: {
      passed: validationResult.passed,
      checks: validationResult.checks || {},
      reasons: validationResult.reasons || [],
      reason: validationResult.reason || null,
    },
    riskAssessment: {
      passed,
      overallScore: score,
      score,
      threshold: riskThresh,
    },
    /** @deprecated Prefer riskAssessment — kept for backward compatibility */
    authenticity: {
      passed,
      score,
      threshold: riskThresh,
    },
    overallPassed: validationResult.passed && passed,
  };
}

module.exports = {
  aggregateScores,
  buildDecision,
  DETECTOR_CATEGORIES,
  HARD_FRAUD_DETECTORS,
  SOFT_QUALITY_DETECTORS,
};

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

/** Hard fraud signals that should always surface when they fail */
const HARD_FRAUD_DETECTORS = new Set([
  'typedTextDetector',
  'screenshotDetector',
  'layoutDetector',
  'logoDetector',
  'checksumValidator',
]);

/** Soft quality signals — advisory unless authenticity fails badly */
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
  let authenticityScore = 0;
  for (const [category, weight] of Object.entries(weights)) {
    const catScore = categoryScores[category] || 0;
    authenticityScore += catScore * weight * 100;
  }

  authenticityScore = Math.round(Math.min(100, Math.max(0, authenticityScore)));

  const typed = detectorResults.find((r) => r.name === 'typedTextDetector');
  const shot = detectorResults.find((r) => r.name === 'screenshotDetector');
  const logo = detectorResults.find((r) => r.name === 'logoDetector');
  const layout = detectorResults.find((r) => r.name === 'layoutDetector');

  if (typed && !typed.passed) {
    authenticityScore = Math.min(authenticityScore, 35);
  }
  if (shot && !shot.passed && shot.score < 0.45) {
    authenticityScore = Math.min(authenticityScore, 40);
  }
  if (logo && !logo.passed && layout && !layout.passed) {
    authenticityScore = Math.min(authenticityScore, 45);
  }

  if (typed && typed.score < 0.5) {
    authenticityScore = Math.min(authenticityScore, 35);
  }

  const authPassed = authenticityScore >= config.authScoreThreshold;

  const fraudIndicators = [];
  const qualityWarnings = [];

  for (const r of detectorResults) {
    if (r.passed || !r.fraudMessage) continue;

    if (HARD_FRAUD_DETECTORS.has(r.name)) {
      fraudIndicators.push(r.fraudMessage);
      continue;
    }

    if (SOFT_QUALITY_DETECTORS.has(r.name)) {
      // Soft fails: only escalate to fraud when authenticity fails AND score is severe
      if (!authPassed && r.score < 0.35) {
        fraudIndicators.push(r.fraudMessage);
      } else {
        qualityWarnings.push(r.fraudMessage);
      }
      continue;
    }

    // Unknown detectors: treat as fraud only when auth fails
    if (!authPassed) fraudIndicators.push(r.fraudMessage);
    else qualityWarnings.push(r.fraudMessage);
  }

  const checks = {};
  for (const result of detectorResults) {
    checks[result.name] = result.passed;
  }

  return {
    authenticityScore,
    categoryScores,
    fraudIndicators: [...new Set(fraudIndicators)],
    qualityWarnings: [...new Set(qualityWarnings)],
    checks,
  };
}

function buildDecision(validationResult, aggregation, threshold) {
  const authThreshold = threshold ?? config.authScoreThreshold;

  return {
    validation: {
      passed: validationResult.passed,
      checks: validationResult.checks || {},
    },
    authenticity: {
      passed: aggregation.authenticityScore >= authThreshold,
      score: aggregation.authenticityScore,
      threshold: authThreshold,
    },
    overallPassed:
      validationResult.passed && aggregation.authenticityScore >= authThreshold,
  };
}

module.exports = {
  aggregateScores,
  buildDecision,
  DETECTOR_CATEGORIES,
  HARD_FRAUD_DETECTORS,
  SOFT_QUALITY_DETECTORS,
};

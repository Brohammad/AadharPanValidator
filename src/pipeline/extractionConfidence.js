const config = require('../config');

/**
 * Shared extraction confidence scorer.
 * Plugins supply field coverage + format/consistency flags; this returns a score with reasons.
 *
 * @param {object} opts
 * @param {number} [opts.ocrConfidence]
 * @param {string[]} [opts.mandatoryFields] - field names that must be present
 * @param {object} [opts.data] - extracted data object
 * @param {string[]} [opts.optionalFields]
 * @param {Array<{name:string, passed:boolean, message?:string}>} [opts.formatChecks]
 * @param {Array<{name:string, passed:boolean, message?:string}>} [opts.consistencyChecks]
 * @param {boolean} [opts.hasDuplicates]
 * @param {boolean} [opts.labelProximityOk]
 * @param {number} [opts.mandatoryWeight=0.55]
 * @param {number} [opts.optionalWeight=0.25]
 * @param {number} [opts.ocrWeight=0.2]
 * @param {string[]} [opts.issues] - human-readable extraction issues
 */
function scoreExtractionConfidence(opts = {}) {
  const {
    ocrConfidence = 0,
    mandatoryFields = [],
    optionalFields = [],
    data = {},
    formatChecks = [],
    consistencyChecks = [],
    hasDuplicates = false,
    labelProximityOk = null,
    mandatoryWeight = 0.55,
    optionalWeight = 0.25,
    ocrWeight = 0.2,
    issues = [],
  } = opts;

  const reasons = [];
  const extractionIssues = [...issues];

  const foundMandatory = mandatoryFields.filter((f) => {
    const v = data[f];
    return v != null && v !== '' && !(Array.isArray(v) && v.length === 0);
  });
  const foundOptional = optionalFields.filter((f) => {
    const v = data[f];
    return v != null && v !== '' && !(Array.isArray(v) && v.length === 0);
  });

  const mandatoryRatio =
    mandatoryFields.length > 0 ? foundMandatory.length / mandatoryFields.length : 1;
  const optionalRatio =
    optionalFields.length > 0 ? foundOptional.length / optionalFields.length : 1;
  const ocrRatio = Math.min(1, Math.max(0, ocrConfidence / 100));

  let score =
    mandatoryRatio * mandatoryWeight * 100 +
    optionalRatio * optionalWeight * 100 +
    ocrRatio * ocrWeight * 100;

  if (mandatoryFields.length && foundMandatory.length < mandatoryFields.length) {
    const missing = mandatoryFields.filter((f) => !foundMandatory.includes(f));
    reasons.push({
      code: 'MISSING_MANDATORY_FIELDS',
      impact: -Math.round((1 - mandatoryRatio) * mandatoryWeight * 100),
      message: `Missing mandatory fields: ${missing.join(', ')}`,
      stage: 'extraction',
    });
    for (const f of missing) {
      if (!extractionIssues.includes(`${f} not found`)) {
        extractionIssues.push(`${f} not found`);
      }
    }
  } else if (mandatoryFields.length) {
    reasons.push({
      code: 'MANDATORY_FIELDS_COMPLETE',
      impact: Math.round(mandatoryWeight * 100),
      message: 'All mandatory fields extracted',
      stage: 'extraction',
    });
  }

  if (ocrConfidence > 0 && ocrConfidence < 50) {
    const impact = -10;
    score += impact;
    reasons.push({
      code: 'AMBIGUOUS_OCR',
      impact,
      message: `Ambiguous OCR (confidence ${ocrConfidence}%) reduces extraction confidence`,
      stage: 'extraction',
    });
  } else if (ocrConfidence >= 70) {
    reasons.push({
      code: 'OCR_SUPPORTS_EXTRACTION',
      impact: Math.round(ocrWeight * 100 * ocrRatio),
      message: `OCR confidence ${ocrConfidence}% supports extraction`,
      stage: 'extraction',
    });
  }

  for (const check of formatChecks) {
    if (!check.passed) {
      score -= 8;
      reasons.push({
        code: 'INVALID_FORMAT',
        impact: -8,
        message: check.message || `Invalid format: ${check.name}`,
        stage: 'extraction',
      });
      if (check.message && !extractionIssues.includes(check.message)) {
        extractionIssues.push(check.message);
      }
    } else {
      reasons.push({
        code: 'FORMAT_VALID',
        impact: 2,
        message: check.message || `Valid format: ${check.name}`,
        stage: 'extraction',
      });
      score += 2;
    }
  }

  for (const check of consistencyChecks) {
    if (!check.passed) {
      score -= 10;
      reasons.push({
        code: 'LOGICAL_INCONSISTENCY',
        impact: -10,
        message: check.message || `Inconsistency: ${check.name}`,
        stage: 'extraction',
      });
    }
  }

  if (hasDuplicates) {
    score -= 8;
    reasons.push({
      code: 'DUPLICATE_VALUES',
      impact: -8,
      message: 'Duplicate extracted values detected',
      stage: 'extraction',
    });
  }

  if (labelProximityOk === false) {
    score -= 5;
    reasons.push({
      code: 'WEAK_LABEL_PROXIMITY',
      impact: -5,
      message: 'Some fields lacked nearby label anchors',
      stage: 'extraction',
    });
  } else if (labelProximityOk === true) {
    score += 3;
    reasons.push({
      code: 'LABEL_PROXIMITY_OK',
      impact: 3,
      message: 'Fields aligned with nearby labels',
      stage: 'extraction',
    });
  }

  const extractionConfidence = Math.round(Math.min(100, Math.max(0, score)));
  const extractionBelowThreshold = extractionConfidence < config.extractionThreshold;

  if (extractionBelowThreshold) {
    reasons.push({
      code: 'EXTRACTION_BELOW_THRESHOLD',
      impact: 0,
      message: `Extraction confidence ${extractionConfidence}% below threshold ${config.extractionThreshold}%`,
      stage: 'extraction',
    });
  }

  return {
    extractionConfidence,
    extractionReasons: reasons,
    extractionIssues,
    extractionBelowThreshold,
  };
}

module.exports = { scoreExtractionConfidence };

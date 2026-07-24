/**
 * PII-safe logging helpers — never log OCR text or extracted field values.
 */

const SENSITIVE_KEYS = new Set([
  'fullOcrText',
  'text',
  'data',
  'ocrText',
  'extracted',
  'aadhaar',
  'pan',
  'passportNumber',
  'cinNumber',
  'mrz',
  'address',
  'name',
  'fatherName',
  'dob',
]);

/**
 * Strip sensitive keys from a log payload (shallow + one nested level).
 */
function sanitizeLogPayload(payload = {}) {
  if (!payload || typeof payload !== 'object') return {};
  const out = {};
  for (const [key, value] of Object.entries(payload)) {
    if (SENSITIVE_KEYS.has(key)) continue;
    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Error)) {
      const nested = {};
      for (const [nk, nv] of Object.entries(value)) {
        if (SENSITIVE_KEYS.has(nk)) continue;
        nested[nk] = nv;
      }
      out[key] = nested;
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Build a structured stage log line for the OCR pipeline.
 */
function buildStageLog({
  requestId,
  filename,
  documentType,
  stage,
  status,
  ocrConfidence,
  classificationConfidence,
  extractionConfidence,
  validationPassed,
  riskScore,
  riskPassed,
  durationMs,
  stopReason,
  ...rest
} = {}) {
  return sanitizeLogPayload({
    requestId,
    filename,
    documentType,
    stage,
    status,
    ocrConfidence,
    classificationConfidence,
    extractionConfidence,
    validationPassed,
    riskScore,
    riskPassed,
    durationMs,
    stopReason,
    ...rest,
  });
}

module.exports = { sanitizeLogPayload, buildStageLog, SENSITIVE_KEYS };

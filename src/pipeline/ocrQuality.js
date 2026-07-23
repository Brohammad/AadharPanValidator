const config = require('../config');

/**
 * Evaluate whether OCR output is good enough to continue the pipeline.
 */
function evaluateOcrQuality(ocrResult, imageQuality = null) {
  const ocrConfidence = ocrResult?.ocrConfidence ?? 0;
  const text = String(ocrResult?.text || '');
  const trimmed = text.trim();
  const alnum = (trimmed.match(/[A-Za-z0-9]/g) || []).length;
  const blur = imageQuality?.blur ?? null;

  const reasons = [];
  const warnings = [];
  let passed = true;

  if (ocrConfidence < config.ocrConfidenceThreshold) {
    passed = false;
    reasons.push(
      `OCR confidence ${ocrConfidence}% below threshold ${config.ocrConfidenceThreshold}%`
    );
  }

  if (alnum < config.ocrMinAlnum) {
    passed = false;
    reasons.push(
      `OCR text too sparse (${alnum} alphanumeric chars; need ≥ ${config.ocrMinAlnum})`
    );
  }

  if (!trimmed) {
    passed = false;
    reasons.push('OCR produced no readable text');
  }

  if (blur != null && blur < config.ocrBlurMin) {
    // Soft warning — only hard-fail when confidence is already weak
    warnings.push(`Image blur is high (Laplacian variance ${blur.toFixed(1)} < ${config.ocrBlurMin})`);
    if (ocrConfidence < config.ocrConfidenceThreshold + 15) {
      passed = false;
      reasons.push('Excessive blur combined with low OCR confidence');
    }
  }

  const symbols = (trimmed.match(/[^A-Za-z0-9\s]/g) || []).length;
  const total = Math.max(trimmed.length, 1);
  if (symbols / total > 0.35 && ocrConfidence < 55) {
    warnings.push('High symbol-to-text ratio suggests noisy OCR');
  }

  return {
    passed,
    ocrConfidence,
    threshold: config.ocrConfidenceThreshold,
    alnumCount: alnum,
    textLength: trimmed.length,
    reasons,
    warnings,
    fullOcrText: text,
  };
}

module.exports = { evaluateOcrQuality };

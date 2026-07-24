const config = require('../config');

/**
 * Evaluate whether OCR output is good enough to continue the pipeline.
 * Returns structured reason codes for explainability.
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

  if (!trimmed) {
    passed = false;
    reasons.push({
      code: 'OCR_TEXT_EMPTY',
      message: 'OCR produced no readable text',
      stage: 'ocr',
    });
  }

  if (ocrConfidence < config.ocrConfidenceThreshold) {
    passed = false;
    reasons.push({
      code: 'OCR_CONFIDENCE_LOW',
      message: `OCR confidence ${ocrConfidence}% below threshold ${config.ocrConfidenceThreshold}%`,
      stage: 'ocr',
    });
  }

  if (alnum < config.ocrMinAlnum) {
    passed = false;
    reasons.push({
      code: 'OCR_ALNUM_LOW',
      message: `OCR text too sparse (${alnum} alphanumeric chars; need ≥ ${config.ocrMinAlnum})`,
      stage: 'ocr',
    });
  }

  if (blur != null && blur < config.ocrBlurMin) {
    warnings.push(
      `Image blur is high (Laplacian variance ${blur.toFixed(1)} < ${config.ocrBlurMin})`
    );
    if (ocrConfidence < config.ocrConfidenceThreshold + 15) {
      passed = false;
      reasons.push({
        code: 'OCR_EXCESSIVE_BLUR',
        message: 'Excessive blur combined with low OCR confidence',
        stage: 'ocr',
      });
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

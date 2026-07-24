const config = require('../config');

function hasStrongIdSignals(text) {
  const upper = String(text || '').toUpperCase();
  const cues = [
    /INCOME|TAX|GOVT|GOVERNMENT/,
    /PERMANENT|PEMANENT|ACCOUNT\s*NUMBER|FATHERS?NAME|FATHER/,
    /AADHAAR|AADHAR|UIDAI|GOVERNMENT\s*OF\s*INDIA/,
    /[A-Z]{5}[0-9OISB]{4}[A-Z]/,
    /\d{4}[\s\-]?\d{4}[\s\-]?\d{4}/,
    /\d{2}[\/\-.]\d{2}[\/\-.]\d{4}/,
  ];
  return cues.filter((re) => re.test(upper)).length >= 2;
}

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
  const strongId = hasStrongIdSignals(text);

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

  // Soft-pass: phone photos of real IDs often OCR at 28–39% conf but still
  // contain Father's Name / Permanent Account / DOB cues we can extract.
  const confFloor = strongId
    ? Math.max(22, config.ocrConfidenceThreshold - 18)
    : config.ocrConfidenceThreshold;

  if (ocrConfidence < confFloor) {
    passed = false;
    reasons.push({
      code: 'OCR_CONFIDENCE_LOW',
      message: `OCR confidence ${ocrConfidence}% below threshold ${confFloor}%`,
      stage: 'ocr',
    });
  } else if (strongId && ocrConfidence < config.ocrConfidenceThreshold) {
    warnings.push(
      `OCR confidence ${ocrConfidence}% below nominal ${config.ocrConfidenceThreshold}%, but strong ID cues present — soft-passing`
    );
  }

  const minAlnum = strongId ? Math.min(config.ocrMinAlnum, 20) : config.ocrMinAlnum;
  if (alnum < minAlnum) {
    passed = false;
    reasons.push({
      code: 'OCR_ALNUM_LOW',
      message: `OCR text too sparse (${alnum} alphanumeric chars; need ≥ ${minAlnum})`,
      stage: 'ocr',
    });
  }

  if (blur != null && blur < config.ocrBlurMin) {
    warnings.push(
      `Image blur is high (Laplacian variance ${blur.toFixed(1)} < ${config.ocrBlurMin})`
    );
    if (ocrConfidence < confFloor + 15 && !strongId) {
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
    threshold: confFloor,
    alnumCount: alnum,
    textLength: trimmed.length,
    reasons,
    warnings,
    fullOcrText: text,
    softPassed: Boolean(strongId && ocrConfidence < config.ocrConfidenceThreshold && passed),
  };
}

module.exports = { evaluateOcrQuality, hasStrongIdSignals };

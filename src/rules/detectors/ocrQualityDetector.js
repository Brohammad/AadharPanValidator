const { createResult } = require('./base');

/**
 * Soft quality gate. Low OCR confidence alone is common on phone photos —
 * pass when structured fields were extracted successfully.
 */
function ocrQualityDetector(ctx) {
  const confidence = (ctx.features?.ocrConfidence || 0) / 100;
  const blur = ctx.features?.imageQuality?.blur || 0;
  const extractionConfidence = ctx.extractionConfidence || 0;
  let score = confidence;

  if (blur < 80) score *= 0.75;
  if (extractionConfidence < 40) score *= 0.85;
  // Successful field extraction offsets noisy OCR
  if (extractionConfidence >= 70) score = Math.max(score, 0.55);
  else if (extractionConfidence >= 50) score = Math.max(score, 0.45);

  // Valid ID number present → OCR was good enough for production decision
  const data = ctx.data || {};
  if (data.pan || data.aadhaar) score = Math.max(score, 0.5);

  score = Math.max(0, Math.min(score, 1));
  const passed = score >= 0.35;
  return createResult(
    'ocrQualityDetector',
    score,
    passed,
    8,
    { ocrConfidence: ctx.features?.ocrConfidence, extractionConfidence },
    'OCR quality too low for reliable extraction'
  );
}

module.exports = ocrQualityDetector;

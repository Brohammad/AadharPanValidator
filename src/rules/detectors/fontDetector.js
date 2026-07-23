const { createResult } = require('./base');

/**
 * Soft quality signal — phone photos naturally have uneven OCR confidence.
 * Does not mean fonts were edited; keep threshold lenient.
 */
function fontDetector(ctx) {
  const words = ctx.features?.words || [];
  if (words.length === 0) {
    return createResult('fontDetector', 0.6, true, 5, {}, null);
  }

  const confidences = words.filter((w) => w.confidence > 0).map((w) => w.confidence);
  if (confidences.length < 5) {
    return createResult('fontDetector', 0.65, true, 5, {}, null);
  }

  const mean = confidences.reduce((a, b) => a + b, 0) / confidences.length;
  const variance =
    confidences.reduce((sum, c) => sum + Math.pow(c - mean, 2), 0) / confidences.length;
  const stdDev = Math.sqrt(variance);

  let score = 0.85;
  if (stdDev < 20) score = 0.95;
  else if (stdDev < 35) score = 0.8;
  else if (stdDev < 50) score = 0.65;
  else score = 0.45;

  const heights = words.map((w) => w.bbox?.y1 - w.bbox?.y0).filter((h) => h > 0);
  if (heights.length > 5) {
    const hMean = heights.reduce((a, b) => a + b, 0) / heights.length;
    const hVar = heights.reduce((s, h) => s + Math.pow(h - hMean, 2), 0) / heights.length;
    // Extreme height variance can indicate pasted text layers
    if (hMean > 0 && Math.sqrt(hVar) / hMean > 0.75) score -= 0.2;
  }

  score = Math.max(0, Math.min(score, 1));
  const passed = score >= 0.4;
  return createResult(
    'fontDetector',
    score,
    passed,
    5,
    { meanConfidence: mean, stdDev },
    'Highly inconsistent text rendering detected'
  );
}

module.exports = fontDetector;

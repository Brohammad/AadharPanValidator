const { createResult } = require('./base');

/**
 * Compression / noise heuristics. Phone photos of real cards often look "noisy"
 * to these metrics — keep thresholds conservative.
 */
function tamperingDetector(ctx) {
  const { features } = ctx;
  const { imageQuality, signals } = features;
  let suspicion = 0;

  if (imageQuality?.noise > 0.22) suspicion += 0.2;
  if (imageQuality?.contrast > 0.9) suspicion += 0.1;
  if (Math.abs(imageQuality?.skewAngle || 0) > 18) suspicion += 0.1;

  const words = features.words || [];
  const confidences = words.filter((w) => w.confidence > 0).map((w) => w.confidence);
  if (confidences.length > 8) {
    const lowConf = confidences.filter((c) => c < 30).length / confidences.length;
    if (lowConf > 0.55) suspicion += 0.15;
  }

  if (signals.edgeDensity > 0.12) suspicion += 0.15;

  // Physical card cues → lower suspicion
  if (signals.hasPhotoLikeRegion) suspicion *= 0.5;
  if (signals.hasQrLikeRegion) suspicion *= 0.7;

  const score = Math.max(0, 1 - suspicion);
  const passed = score >= 0.5;
  return createResult(
    'tamperingDetector',
    score,
    passed,
    15,
    { suspicion },
    'Possible image tampering or compression artifacts detected'
  );
}

module.exports = tamperingDetector;

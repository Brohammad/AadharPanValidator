const { createResult } = require('./base');

function screenshotDetector(ctx) {
  const { features } = ctx;
  const { signals, imageQuality, metadata } = features;

  if (signals.hasPhotoLikeRegion && !signals.isDarkUi) {
    return createResult('screenshotDetector', 0.9, true, 20, { bypass: 'physical_card' }, null);
  }

  let suspicion = 0;

  if (signals.isDarkUi) suspicion += 0.7;
  if (signals.hasTimestampCue) suspicion += 0.45;
  if (signals.hasUiChrome) suspicion += 0.4;
  if (signals.hasScreenshotCues) suspicion += 0.35;
  // CamScanner watermark alone is not fraud — many legitimate scans use it
  if (signals.hasCamScanner && signals.isDarkUi) suspicion += 0.05;

  const ratio = metadata.aspectRatio || 1;
  if (ratio > 0.4 && ratio < 0.7 && signals.isDarkUi) suspicion += 0.2;
  if (ratio > 2.2) suspicion += 0.1;

  if (imageQuality?.brightness > 230 && signals.edgeDensity < 0.01) suspicion += 0.2;

  if (
    signals.isDarkUi &&
    (signals.hasGovernmentOfIndia || signals.hasIncomeTax || signals.hasUidai || signals.hasPanLabel)
  ) {
    suspicion += 0.35;
  }

  const score = Math.max(0, 1 - Math.min(suspicion, 1));
  const passed = score >= 0.55;
  return createResult(
    'screenshotDetector',
    score,
    passed,
    20,
    { suspicion },
    'Screenshot / UI capture detected'
  );
}

module.exports = screenshotDetector;

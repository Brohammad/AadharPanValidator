const { createResult } = require('./base');

function layoutDetector(ctx) {
  const { features, documentType } = ctx;
  const { signals, metadata } = features;
  let score = 0;

  if (signals.isDarkUi || signals.hasExplicitFake || signals.hasJunkWords) {
    return createResult(
      'layoutDetector',
      0.1,
      false,
      25,
      {},
      'Card layout mismatch'
    );
  }

  if (documentType === 'AADHAAR') {
    if (signals.hasAadhaarLabel || signals.hasUidai) score += 0.25;
    if (signals.hasGovernmentOfIndia) score += 0.15;
    if (signals.hasQrLikeRegion) score += 0.2;
    if (signals.hasPhotoLikeRegion) score += 0.2;
    const ratio = metadata.aspectRatio || 1;
    // Card aspect or photo-of-card (can be more square)
    if (ratio > 1.1 && ratio < 2.2) score += 0.15;
    if (signals.lineCount >= 3) score += 0.05;
  } else if (documentType === 'PAN') {
    if (signals.hasPanLabel) score += 0.25;
    if (signals.hasIncomeTax) score += 0.2;
    if (signals.hasGovernmentOfIndia) score += 0.1;
    if (signals.hasQrLikeRegion) score += 0.2;
    if (signals.hasPhotoLikeRegion) score += 0.15;
    const ratio = metadata.aspectRatio || 1;
    if (ratio > 1.1 && ratio < 2.4) score += 0.1;
    if (signals.lineCount >= 2) score += 0.05;
  }

  // No visual card features → fail layout
  if (!signals.hasPhotoLikeRegion && !signals.hasQrLikeRegion) {
    score = Math.min(score, 0.35);
  }

  const passed = score >= 0.45;
  return createResult(
    'layoutDetector',
    Math.min(score, 1),
    passed,
    25,
    { scoreBreakdown: score },
    'Card layout mismatch'
  );
}

module.exports = layoutDetector;

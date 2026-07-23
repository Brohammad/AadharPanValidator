const { createResult } = require('./base');

function logoDetector(ctx) {
  const { features, documentType } = ctx;
  const { signals } = features;
  let score = 0;

  // Text-only screenshots claiming govt headers should not get logo credit
  if (signals.isDarkUi || signals.hasExplicitFake || signals.hasJunkWords) {
    return createResult(
      'logoDetector',
      0.05,
      false,
      20,
      { reason: 'ui_or_fake_cues' },
      'Government emblem missing'
    );
  }

  if (signals.hasGovernmentOfIndia) score += 0.35;
  if (documentType === 'AADHAAR' && signals.hasUidai) score += 0.25;
  if (documentType === 'PAN' && signals.hasIncomeTax) score += 0.25;

  // Visual cues that real cards have
  if (signals.hasQrLikeRegion) score += 0.2;
  if (signals.hasPhotoLikeRegion) score += 0.2;
  if (features.imageQuality?.contrast > 0.12) score += 0.05;
  if (signals.edgeDensity > 0.015) score += 0.1;

  // Plain text with keywords but no visual security features
  if (
    (signals.hasGovernmentOfIndia || signals.hasIncomeTax) &&
    !signals.hasQrLikeRegion &&
    !signals.hasPhotoLikeRegion
  ) {
    score = Math.min(score, 0.35);
  }

  const passed = score >= 0.45;
  return createResult(
    'logoDetector',
    Math.min(score, 1),
    passed,
    20,
    {},
    'Government emblem missing'
  );
}

module.exports = logoDetector;

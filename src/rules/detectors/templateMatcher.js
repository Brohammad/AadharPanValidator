const { createResult } = require('./base');

function templateMatcher(ctx) {
  const { features, documentType, data, validationResult } = ctx;
  const { signals } = features;

  if (signals.isDarkUi || signals.hasExplicitFake || signals.hasJunkWords) {
    return createResult(
      'templateMatcher',
      0.1,
      false,
      12,
      {},
      'Document template does not match expected format'
    );
  }

  let score = 0;

  if (documentType === 'AADHAAR') {
    if (signals.hasUidai || signals.hasAadhaarLabel) score += 0.35;
    if (signals.hasGovernmentOfIndia) score += 0.2;
    if (signals.hasQrLikeRegion) score += 0.25;
    if (signals.hasPhotoLikeRegion) score += 0.2;
    if (data?.aadhaar && validationResult?.passed) score += 0.2;
  } else if (documentType === 'PAN') {
    if (signals.hasIncomeTax || signals.hasPanLabel) score += 0.35;
    if (signals.hasGovernmentOfIndia) score += 0.15;
    if (signals.hasQrLikeRegion) score += 0.25;
    if (signals.hasPhotoLikeRegion) score += 0.2;
    if (data?.pan && validationResult?.passed) score += 0.2;
  }

  // Soften the old hard cap: labels + valid ID can pass without QR detection
  if (!signals.hasQrLikeRegion && !signals.hasPhotoLikeRegion) {
    if (validationResult?.passed && (signals.hasPanLabel || signals.hasAadhaarLabel || signals.hasIncomeTax || signals.hasUidai)) {
      score = Math.min(score, 0.55);
    } else {
      score = Math.min(score, 0.35);
    }
  }

  const passed = score >= 0.4;
  return createResult(
    'templateMatcher',
    Math.min(score, 1),
    passed,
    12,
    {},
    'Document template does not match expected format'
  );
}

module.exports = templateMatcher;

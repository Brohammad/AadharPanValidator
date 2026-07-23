const { createResult } = require('./base');

function typedTextDetector(ctx) {
  const { features } = ctx;
  const { signals, imageQuality, ocrConfidence } = features;

  // Physical card cues override typed-text suspicion
  if (signals.hasPhotoLikeRegion && (signals.hasQrLikeRegion || signals.edgeDensity > 0.02)) {
    return createResult('typedTextDetector', 0.9, true, 25, { bypass: 'physical_card' }, null);
  }

  let suspicion = 0;

  if (signals.hasExplicitFake) suspicion += 0.9;
  if (signals.hasJunkWords) suspicion += 0.55;
  if (signals.hasNotepadCues) suspicion += 0.5;
  if (signals.hasUiChrome) suspicion += 0.45;
  if (signals.hasTimestampCue) suspicion += 0.35;
  if (signals.isDarkUi) suspicion += 0.55;
  if (signals.isNearWhiteBg && !signals.hasPhotoLikeRegion && !signals.hasQrLikeRegion) {
    suspicion += 0.35;
  }

  if (ocrConfidence >= 85 && !signals.hasPhotoLikeRegion && !signals.hasQrLikeRegion) {
    suspicion += 0.4;
  }

  if ((imageQuality?.brightness ?? 128) < 90 && !signals.hasPhotoLikeRegion) {
    suspicion += 0.35;
  }

  if (
    /UNIQUE\s*IDENTIFICATION\s*AUTHORITY/i.test(features.text || '') &&
    !signals.hasPhotoLikeRegion
  ) {
    suspicion += 0.3;
  }

  if (signals.wordCount > 0 && signals.lineCount <= 8 && !signals.hasPhotoLikeRegion) {
    if (signals.hasGovernmentOfIndia || signals.hasIncomeTax || signals.hasUidai) {
      suspicion += 0.25;
    }
  }

  if (imageQuality?.contrast < 0.12 && signals.edgeDensity < 0.015) {
    suspicion += 0.2;
  }

  if (signals.colorVariance < 30 && !signals.hasPhotoLikeRegion) {
    suspicion += 0.25;
  }

  if (!signals.hasPhotoLikeRegion && !signals.hasQrLikeRegion) {
    suspicion += 0.35;
  }

  const score = Math.max(0, 1 - Math.min(suspicion, 1));
  const passed = score >= 0.5;
  return createResult(
    'typedTextDetector',
    score,
    passed,
    25,
    { suspicion },
    'Typed text / non-card document detected'
  );
}

module.exports = typedTextDetector;

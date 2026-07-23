const { createResult } = require('./base');

function cropDetector(ctx) {
  const { metadata } = ctx.features || {};
  const { width, height, aspectRatio } = metadata || {};
  let score = 0.8;

  if (aspectRatio && (aspectRatio < 0.5 || aspectRatio > 3.0)) {
    score -= 0.4;
  }

  const minDim = Math.min(width || 0, height || 0);
  const maxDim = Math.max(width || 0, height || 0);
  if (maxDim > 0 && minDim / maxDim < 0.3) {
    score -= 0.25;
  }

  score = Math.max(0, Math.min(score, 1));
  const passed = score >= 0.5;
  return createResult(
    'cropDetector',
    score,
    passed,
    8,
    { aspectRatio },
    'Document appears heavily cropped'
  );
}

module.exports = cropDetector;

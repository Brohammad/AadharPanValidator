const { createResult } = require('./base');

function resolutionDetector(ctx) {
  const { width, height } = ctx.features?.metadata || {};
  const dpi = ctx.features?.imageQuality?.estimatedDpi || 0;
  let score = 0;

  const minDim = Math.min(width || 0, height || 0);
  if (minDim >= 800) score += 0.4;
  else if (minDim >= 500) score += 0.25;
  else score += 0.1;

  if (dpi >= 150) score += 0.35;
  else if (dpi >= 100) score += 0.2;
  else score += 0.05;

  if ((width || 0) >= 1000 && (height || 0) >= 600) score += 0.25;

  score = Math.min(score, 1);
  const passed = score >= 0.5;
  return createResult(
    'resolutionDetector',
    score,
    passed,
    10,
    { width, height, dpi },
    'Resolution too low'
  );
}

module.exports = resolutionDetector;

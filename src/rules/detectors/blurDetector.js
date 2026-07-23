const { createResult } = require('./base');

function blurDetector(ctx) {
  const blur = ctx.features?.imageQuality?.blur || 0;
  let score = 1;

  if (blur < 50) score = 0.2;
  else if (blur < 100) score = 0.5;
  else if (blur < 200) score = 0.75;
  else score = 0.95;

  const passed = score >= 0.5;
  return createResult(
    'blurDetector',
    score,
    passed,
    10,
    { blur },
    'Image too blurry for reliable verification'
  );
}

module.exports = blurDetector;

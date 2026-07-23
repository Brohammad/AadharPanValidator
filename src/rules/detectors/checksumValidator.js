const { createResult } = require('./base');

function checksumValidator(ctx) {
  const { validationResult } = ctx;
  const passed = validationResult?.passed === true;
  const score = passed ? 1 : 0;

  return createResult(
    'checksumValidator',
    score,
    passed,
    15,
    { checks: validationResult?.checks || {} },
    passed ? null : validationResult?.reason || 'Validation failed'
  );
}

module.exports = checksumValidator;

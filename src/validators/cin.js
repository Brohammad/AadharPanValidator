/**
 * CIN (Corporate Identity Number) format validation.
 * Pattern: [UL] + 5 digits + 2 letters (state) + 4 digits (year) + 3 letters + 6 digits
 */

const CIN_REGEX = /^[UL]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/;

function normalizeCin(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function validateCin(raw) {
  const checks = [];
  const reasons = [];
  const normalized = normalizeCin(raw);

  if (!normalized) {
    return {
      passed: false,
      valid: false,
      checks: { present: false, format: false, length: false },
      reasons: [
        { code: 'CIN_MISSING', message: 'CIN number missing', stage: 'validation' },
      ],
      reason: 'CIN number missing',
      normalized: null,
    };
  }

  const lengthOk = normalized.length === 21;
  const formatOk = CIN_REGEX.test(normalized);
  const listingOk = /^[UL]/.test(normalized);
  const yearPart = formatOk ? parseInt(normalized.slice(8, 12), 10) : null;
  const yearOk = yearPart != null && yearPart >= 1850 && yearPart <= new Date().getFullYear() + 1;

  checks.push({
    name: 'length',
    passed: lengthOk,
    reason: lengthOk ? null : `CIN length ${normalized.length} (expected 21)`,
    code: lengthOk ? null : 'CIN_LENGTH_INVALID',
  });
  checks.push({
    name: 'format',
    passed: formatOk,
    reason: formatOk ? null : 'CIN format invalid',
    code: formatOk ? null : 'CIN_FORMAT_INVALID',
  });
  checks.push({
    name: 'listingType',
    passed: listingOk,
    reason: listingOk ? null : 'CIN must start with U (unlisted) or L (listed)',
    code: listingOk ? null : 'CIN_LISTING_INVALID',
  });
  checks.push({
    name: 'incorporationYear',
    passed: yearOk,
    reason: yearOk ? null : `Implausible incorporation year in CIN (${yearPart})`,
    code: yearOk ? null : 'CIN_YEAR_INVALID',
  });

  const passed = lengthOk && formatOk && listingOk && yearOk;
  for (const c of checks) {
    if (!c.passed && c.reason) {
      reasons.push({ code: c.code, message: c.reason, stage: 'validation' });
    }
  }

  const checkMap = {};
  for (const c of checks) checkMap[c.name] = c.passed;

  return {
    passed,
    valid: passed,
    checks: checkMap,
    checkDetails: checks,
    reasons,
    reason: passed ? null : reasons[0]?.message || 'CIN validation failed',
    normalized: formatOk ? normalized : null,
  };
}

module.exports = { validateCin, normalizeCin, CIN_REGEX };

const { validateMrzCheckDigits } = require('../shared/mrz');
const {
  isValidDate,
  isPlausibleDob,
  checkDateOrder,
} = require('./dates');

const PASSPORT_NUMBER_RE = /^[A-Z][0-9]{7}$/;

/**
 * Passport field + MRZ validation.
 */
function validatePassport(data = {}) {
  const checks = {};
  const reasons = [];
  const checkDetails = [];

  const number = data.passportNumber
    ? String(data.passportNumber).toUpperCase().replace(/[^A-Z0-9]/g, '')
    : null;

  const numberOk = !!(number && PASSPORT_NUMBER_RE.test(number));
  checks.passportNumberFormat = numberOk;
  checkDetails.push({
    name: 'passportNumberFormat',
    passed: numberOk,
    reason: numberOk ? null : 'Passport number must be 1 letter + 7 digits',
    code: numberOk ? null : 'PASSPORT_NUMBER_FORMAT',
  });
  if (!numberOk) {
    reasons.push({
      code: 'PASSPORT_NUMBER_FORMAT',
      message: number
        ? 'Passport number format invalid'
        : 'Passport number missing',
      stage: 'validation',
    });
  }

  const dobOk = !data.dateOfBirth || isPlausibleDob(data.dateOfBirth);
  checks.dateOfBirth = dobOk;
  if (data.dateOfBirth && !dobOk) {
    reasons.push({
      code: 'INVALID_DOB',
      message: 'Date of birth is invalid or implausible',
      stage: 'validation',
    });
  }

  const issueExpiry = checkDateOrder(data.dateOfIssue, data.dateOfExpiry, {
    label: 'issue before expiry',
  });
  checks.issueBeforeExpiry = issueExpiry.passed || !!issueExpiry.skipped;
  if (!issueExpiry.skipped && !issueExpiry.passed) {
    reasons.push({
      code: issueExpiry.code || 'DATE_ORDER_INVALID',
      message: issueExpiry.reason,
      stage: 'validation',
    });
  }

  const dobBeforeExpiry = checkDateOrder(data.dateOfBirth, data.dateOfExpiry, {
    label: 'DOB before expiry',
  });
  checks.dobBeforeExpiry = dobBeforeExpiry.passed || !!dobBeforeExpiry.skipped;
  if (!dobBeforeExpiry.skipped && !dobBeforeExpiry.passed) {
    reasons.push({
      code: dobBeforeExpiry.code || 'DATE_ORDER_INVALID',
      message: dobBeforeExpiry.reason,
      stage: 'validation',
    });
  }

  let mrzResult = { passed: true, checks: {}, reasons: [] };
  if (data.mrz) {
    mrzResult = validateMrzCheckDigits(data.mrz);
    checks.mrzChecksum = mrzResult.passed;
    for (const [k, v] of Object.entries(mrzResult.checks || {})) {
      checks[`mrz_${k}`] = v;
    }
    reasons.push(...(mrzResult.reasons || []));
  } else {
    checks.mrzChecksum = false;
    reasons.push({
      code: 'MRZ_MISSING',
      message: 'MRZ not found — checksum validation skipped as fail',
      stage: 'validation',
    });
  }

  // Soft: issue/expiry presence when we have number
  if (data.dateOfIssue && !isValidDate(data.dateOfIssue)) {
    checks.dateOfIssue = false;
    reasons.push({
      code: 'INVALID_DATE',
      message: 'Date of issue is invalid',
      stage: 'validation',
    });
  } else if (data.dateOfIssue) {
    checks.dateOfIssue = true;
  }

  if (data.dateOfExpiry && !isValidDate(data.dateOfExpiry)) {
    checks.dateOfExpiry = false;
    reasons.push({
      code: 'INVALID_DATE',
      message: 'Date of expiry is invalid',
      stage: 'validation',
    });
  } else if (data.dateOfExpiry) {
    checks.dateOfExpiry = true;
  }

  const passed =
    numberOk &&
    dobOk &&
    (issueExpiry.passed || issueExpiry.skipped) &&
    (dobBeforeExpiry.passed || dobBeforeExpiry.skipped) &&
    (data.mrz ? mrzResult.passed : numberOk);

  return {
    passed,
    checks,
    checkDetails,
    reasons,
    reason: passed ? null : reasons[0]?.message || 'Passport validation failed',
  };
}

module.exports = { validatePassport, PASSPORT_NUMBER_RE };

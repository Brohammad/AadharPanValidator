const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { validateAadhaar, verhoeffChecksum } = require('../src/validators/aadhaar');
const { validatePan } = require('../src/validators/pan');
const { validateCin } = require('../src/validators/cin');
const { validatePassport } = require('../src/validators/passport');
const { isValidDate, isDateBefore, checkDateOrder, isPlausibleDob } = require('../src/validators/dates');
const { mrzCheckDigit, validateMrzCheckDigits } = require('../src/shared/mrz');

describe('aadhaar validator', () => {
  it('accepts a Verhoeff-valid 12-digit number', () => {
    const base = '23456789012';
    const cd = verhoeffChecksum(base);
    const num = base + cd;
    const result = validateAadhaar(num);
    assert.equal(result.valid, true);
  });

  it('rejects checksum mismatch', () => {
    const result = validateAadhaar('234567890121');
    assert.equal(result.valid, false);
  });
});

describe('pan validator', () => {
  it('accepts valid PAN format', () => {
    const result = validatePan('ABCDE1234F');
    assert.equal(result.valid, true);
  });

  it('rejects wrong length', () => {
    const result = validatePan('ABCDE1234');
    assert.equal(result.valid, false);
  });
});

describe('cin validator', () => {
  it('accepts valid CIN', () => {
    const result = validateCin('U72900MH2018PTC312456');
    assert.equal(result.passed, true);
    assert.equal(result.normalized, 'U72900MH2018PTC312456');
  });

  it('rejects bad format with reason codes', () => {
    const result = validateCin('INVALID');
    assert.equal(result.passed, false);
    assert.ok(result.reasons.some((r) => r.code === 'CIN_FORMAT_INVALID' || r.code === 'CIN_LENGTH_INVALID'));
  });
});

describe('dates validator', () => {
  it('parses DD/MM/YYYY', () => {
    assert.ok(isValidDate('15/03/2018'));
  });

  it('checks date ordering', () => {
    assert.equal(isDateBefore('01/01/2020', '01/01/2021'), true);
    const check = checkDateOrder('01/01/2022', '01/01/2021', { label: 'test' });
    assert.equal(check.passed, false);
    assert.equal(check.code, 'DATE_ORDER_INVALID');
  });

  it('rejects future DOB', () => {
    assert.equal(isPlausibleDob('01/01/2099'), false);
  });
});

describe('passport / MRZ', () => {
  it('computes ICAO check digit', () => {
    assert.equal(mrzCheckDigit('L898902C3'), '6');
  });

  it('validates passport number format', () => {
    const ok = validatePassport({
      passportNumber: 'Z1234567',
      dateOfBirth: '01/01/1990',
      dateOfIssue: '01/01/2020',
      dateOfExpiry: '01/01/2030',
      mrz: null,
    });
    // Without MRZ, still passes number + dates
    assert.equal(ok.checks.passportNumberFormat, true);
  });

  it('fails on issue after expiry', () => {
    const result = validatePassport({
      passportNumber: 'Z1234567',
      dateOfIssue: '01/01/2030',
      dateOfExpiry: '01/01/2020',
      mrz: null,
    });
    assert.equal(result.checks.issueBeforeExpiry, false);
  });

  it('validates MRZ check digits when present', () => {
    // Build a TD3 line 2 with correct ICAO check digits
    const num = 'L898902C3';
    const numCd = mrzCheckDigit(num);
    const dob = '740812';
    const dobCd = mrzCheckDigit(dob);
    const exp = '120415';
    const expCd = mrzCheckDigit(exp);
    const personal14 = 'ZE184226B<<<<<'; // 14 chars; check digit appended
    const personalCd = mrzCheckDigit(personal14);
    const personal = personal14 + personalCd; // 15 chars → positions 28-42
    const composite = num + numCd + dob + dobCd + exp + expCd + personal;
    const compCd = mrzCheckDigit(composite);
    const line1 = 'P<UTOLERNER<<ERIK<<<<<<<<<<<<<<<<<<<<<<<<<<<'.padEnd(44, '<').slice(0, 44);
    const line2 = `${num}${numCd}UTO${dob}${dobCd}M${exp}${expCd}${personal}${compCd}`
      .padEnd(44, '<')
      .slice(0, 44);
    const mrz = `${line1}\n${line2}`;
    const result = validateMrzCheckDigits(mrz);
    assert.equal(result.passed, true, JSON.stringify(result.reasons));
  });
});

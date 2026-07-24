/**
 * ICAO TD3 passport MRZ parser (2 lines × 44 chars).
 * Tolerates common OCR substitutions (0/O, 1/I, < padding).
 */

/** ICAO 9303 check digit */
function mrzCheckDigit(str) {
  const weights = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < String(str || '').length; i++) {
    const ch = str[i];
    let v;
    if (ch >= '0' && ch <= '9') v = ch.charCodeAt(0) - 48;
    else if (ch >= 'A' && ch <= 'Z') v = ch.charCodeAt(0) - 55;
    else if (ch === '<') v = 0;
    else continue;
    sum += v * weights[i % 3];
  }
  return String(sum % 10);
}

/**
 * Validate TD3 MRZ check digits (passport number, DOB, expiry, composite).
 * @returns {{ passed: boolean, checks: object, reasons: object[] }}
 */
function validateMrzCheckDigits(mrzText) {
  const reasons = [];
  const checks = {
    present: false,
    passportNumberCheck: false,
    dobCheck: false,
    expiryCheck: false,
    compositeCheck: false,
  };

  if (!mrzText) {
    reasons.push({
      code: 'MRZ_MISSING',
      message: 'MRZ not present for checksum validation',
      stage: 'validation',
    });
    return { passed: false, checks, reasons };
  }

  const lines = String(mrzText)
    .split('\n')
    .map(cleanMrzLine)
    .filter((l) => l.length >= 28);

  let l1 = lines.find((l) => /^P/.test(l));
  let l2 = null;
  if (l1) {
    const idx = lines.indexOf(l1);
    l2 = lines[idx + 1] || lines.find((l, i) => i !== idx && /\d/.test(l));
  }
  if (!l1 || !l2) {
    const compact = cleanMrzLine(mrzText);
    const pIdx = compact.indexOf('P<');
    if (pIdx >= 0 && compact.length >= pIdx + 88) {
      l1 = compact.slice(pIdx, pIdx + 44);
      l2 = compact.slice(pIdx + 44, pIdx + 88);
    }
  }

  if (!l1 || !l2) {
    reasons.push({
      code: 'MRZ_PARSE_FAIL',
      message: 'Could not parse MRZ lines for checksum validation',
      stage: 'validation',
    });
    return { passed: false, checks, reasons };
  }

  l1 = l1.padEnd(44, '<').slice(0, 44);
  l2 = l2.padEnd(44, '<').slice(0, 44);
  checks.present = true;

  const passportField = l2.slice(0, 9);
  const passportCd = l2[9];
  checks.passportNumberCheck = mrzCheckDigit(passportField) === passportCd;
  if (!checks.passportNumberCheck) {
    reasons.push({
      code: 'MRZ_PASSPORT_CHECK_FAIL',
      message: 'MRZ passport number check digit mismatch',
      stage: 'validation',
    });
  }

  const dobField = l2.slice(13, 19);
  const dobCd = l2[19];
  checks.dobCheck = mrzCheckDigit(dobField) === dobCd;
  if (!checks.dobCheck) {
    reasons.push({
      code: 'MRZ_DOB_CHECK_FAIL',
      message: 'MRZ date-of-birth check digit mismatch',
      stage: 'validation',
    });
  }

  const expField = l2.slice(21, 27);
  const expCd = l2[27];
  checks.expiryCheck = mrzCheckDigit(expField) === expCd;
  if (!checks.expiryCheck) {
    reasons.push({
      code: 'MRZ_EXPIRY_CHECK_FAIL',
      message: 'MRZ expiry check digit mismatch',
      stage: 'validation',
    });
  }

  const composite =
    passportField + passportCd + dobField + dobCd + expField + expCd + l2.slice(28, 43);
  const compositeCd = l2[43];
  checks.compositeCheck = mrzCheckDigit(composite) === compositeCd;
  if (!checks.compositeCheck) {
    reasons.push({
      code: 'MRZ_COMPOSITE_CHECK_FAIL',
      message: 'MRZ composite check digit mismatch',
      stage: 'validation',
    });
  }

  const passed =
    checks.passportNumberCheck && checks.dobCheck && checks.expiryCheck && checks.compositeCheck;

  return { passed, checks, reasons, line1: l1, line2: l2 };
}

function fixMrzChar(ch) {
  const map = { ' ': '<', O: '0', Q: '0', D: '0', I: '1', L: '1', B: '8', S: '5', Z: '2', G: '6' };
  // Only digit positions use digit fixes; callers decide context
  return map[ch] || ch;
}

function cleanMrzLine(line) {
  return String(line || '')
    .toUpperCase()
    .replace(/[^A-Z0-9<]/g, '')
    .replace(/ /g, '<');
}

function findMrzLines(text) {
  const upper = text.toUpperCase().replace(/\r/g, '');
  const candidates = [];

  // Prefer lines starting with P<
  for (const raw of upper.split('\n')) {
    const line = cleanMrzLine(raw);
    if (line.length >= 28 && /^P[A-Z<]/.test(line)) candidates.push(line.padEnd(44, '<').slice(0, 44));
    else if (line.length >= 35 && /<{2,}/.test(line) && /\d/.test(line)) {
      candidates.push(line.padEnd(44, '<').slice(0, 44));
    }
  }

  // Also try compacting OCR that lost newlines
  const compact = cleanMrzLine(upper);
  const pIdx = compact.indexOf('P<');
  if (pIdx >= 0 && compact.length >= pIdx + 88) {
    candidates.unshift(compact.slice(pIdx, pIdx + 44));
    candidates.push(compact.slice(pIdx + 44, pIdx + 88));
  }

  // Deduplicate while preserving order
  const seen = new Set();
  const lines = [];
  for (const c of candidates) {
    if (seen.has(c)) continue;
    seen.add(c);
    lines.push(c);
  }
  return lines;
}

function parseNames(nameField) {
  const parts = nameField.split('<<');
  const surname = (parts[0] || '').replace(/</g, ' ').replace(/\s+/g, ' ').trim();
  const givenName = (parts[1] || '')
    .replace(/</g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { surname: surname || null, givenName: givenName || null };
}

function parseYyMmDd(raw) {
  if (!raw || raw.length < 6) return null;
  let s = raw.slice(0, 6);
  s = s
    .split('')
    .map((ch, i) => {
      if (/[0-9]/.test(ch)) return ch;
      return fixMrzChar(ch);
    })
    .join('');
  if (!/^\d{6}$/.test(s)) return null;
  const yy = parseInt(s.slice(0, 2), 10);
  const mm = s.slice(2, 4);
  const dd = s.slice(4, 6);
  const year = yy >= 50 ? 1900 + yy : 2000 + yy;
  return `${dd}/${mm}/${year}`;
}

function parseTd3(line1, line2) {
  if (!line1 || !line2) return null;
  const l1 = line1.padEnd(44, '<').slice(0, 44);
  const l2 = line2.padEnd(44, '<').slice(0, 44);

  if (!/^P/.test(l1)) return null;

  const passportType = l1[0] + (l1[1] !== '<' ? l1[1] : '');
  const countryCode = l1.slice(2, 5).replace(/</g, '');
  const { surname, givenName } = parseNames(l1.slice(5));

  const passportNumber = l2.slice(0, 9).replace(/</g, '');
  const nationality = l2.slice(10, 13).replace(/</g, '');
  const dateOfBirth = parseYyMmDd(l2.slice(13, 19));
  const sexChar = l2[20];
  const gender = sexChar === 'M' ? 'MALE' : sexChar === 'F' ? 'FEMALE' : sexChar === '<' ? null : sexChar;
  const dateOfExpiry = parseYyMmDd(l2.slice(21, 27));
  const personalNumber = l2.slice(28, 42).replace(/</g, '') || null;

  return {
    passportType: passportType || null,
    countryCode: countryCode || null,
    surname,
    givenName,
    passportNumber: passportNumber || null,
    nationality: nationality || null,
    dateOfBirth,
    gender,
    dateOfExpiry,
    personalNumber,
    mrz: `${l1}\n${l2}`,
  };
}

function parseMrz(text) {
  const lines = findMrzLines(text);
  if (lines.length < 2) {
    // Try first P< line + next numeric-heavy line
    const pLine = lines.find((l) => /^P/.test(l));
    if (!pLine) return { mrz: null, fields: null };
    const idx = lines.indexOf(pLine);
    const second = lines[idx + 1] || null;
    if (!second) return { mrz: pLine, fields: null };
    const fields = parseTd3(pLine, second);
    return { mrz: fields?.mrz || `${pLine}\n${second}`, fields };
  }

  // Find best P< + following line pair
  for (let i = 0; i < lines.length - 1; i++) {
    if (/^P/.test(lines[i])) {
      const fields = parseTd3(lines[i], lines[i + 1]);
      if (fields?.passportNumber) return { mrz: fields.mrz, fields };
    }
  }

  const fields = parseTd3(lines[0], lines[1]);
  return { mrz: fields?.mrz || `${lines[0]}\n${lines[1]}`, fields };
}

module.exports = {
  parseMrz,
  findMrzLines,
  parseTd3,
  cleanMrzLine,
  mrzCheckDigit,
  validateMrzCheckDigits,
};

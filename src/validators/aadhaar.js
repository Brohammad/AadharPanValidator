const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];

const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

const VERHOEFF_INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

function verhoeffValidate(number) {
  let c = 0;
  const digits = String(number).split('').reverse();
  for (let i = 0; i < digits.length; i++) {
    c = VERHOEFF_D[c][VERHOEFF_P[i % 8][parseInt(digits[i], 10)]];
  }
  return c === 0;
}

/** Check digit to append (for generating test numbers). */
function verhoeffChecksum(number) {
  let c = 0;
  const digits = String(number).split('').reverse();
  for (let i = 0; i < digits.length; i++) {
    c = VERHOEFF_D[c][VERHOEFF_P[(i + 1) % 8][parseInt(digits[i], 10)]];
  }
  return VERHOEFF_INV[c];
}

function validateAadhaar(number) {
  const cleaned = String(number).replace(/\s/g, '');
  if (!/^\d{12}$/.test(cleaned)) {
    return { valid: false, reason: 'Aadhaar must be exactly 12 numeric digits' };
  }
  if (cleaned[0] === '0' || cleaned[0] === '1') {
    return { valid: false, reason: 'Aadhaar cannot start with 0 or 1' };
  }
  // UIDAI: full 12-digit Verhoeff residual must be 0
  if (!verhoeffValidate(cleaned)) {
    return { valid: false, reason: 'Verhoeff checksum validation failed' };
  }
  return { valid: true, normalized: cleaned };
}

function extractAadhaarNumbers(text) {
  const candidates = [];

  // Prefer spaced 4-4-4 patterns
  const spaced = text.match(/\b\d{4}[\s\-.]?\d{4}[\s\-.]?\d{4}\b/g) || [];
  for (const match of spaced) {
    candidates.push(match.replace(/\D/g, ''));
  }

  // Any run of digits/spaces that collapses to 12 digits
  const loose = text.match(/\d[\d\s\-.]{10,20}\d/g) || [];
  for (const match of loose) {
    const digits = match.replace(/\D/g, '');
    if (digits.length === 12) candidates.push(digits);
  }

  // Fallback: all digit sequences of length 12 from stripped text
  const stripped = text.replace(/\D/g, ' ');
  const pure = stripped.match(/\d{12}/g) || [];
  candidates.push(...pure);

  return [...new Set(candidates.filter((c) => c.length === 12))];
}

module.exports = { validateAadhaar, extractAadhaarNumbers, verhoeffChecksum, verhoeffValidate };

const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

function normalizePan(number) {
  const raw = String(number).replace(/\s/g, '').toUpperCase();
  if (raw.length !== 10) return raw;

  const chars = raw.split('');
  for (let i = 0; i < 10; i++) {
    if (i < 5 || i === 9) {
      if (chars[i] === '0') chars[i] = 'O';
      if (chars[i] === '1') chars[i] = 'I';
    } else {
      if (chars[i] === 'O') chars[i] = '0';
      if (chars[i] === 'I') chars[i] = '1';
      if (chars[i] === 'S') chars[i] = '5';
      if (chars[i] === 'B') chars[i] = '8';
    }
  }
  return chars.join('');
}

function validatePan(number) {
  const normalized = normalizePan(number);
  if (normalized.length !== 10) {
    return { valid: false, reason: 'PAN must be exactly 10 characters' };
  }
  if (!PAN_PATTERN.test(normalized)) {
    return { valid: false, reason: 'PAN must match pattern AAAAA9999A' };
  }
  return { valid: true, normalized };
}

function extractPanNumbers(text) {
  const upper = text.toUpperCase();
  const candidates = [];

  // Exact PAN pattern
  for (const match of upper.match(/\b[A-Z]{5}[0-9]{4}[A-Z]\b/g) || []) {
    candidates.push(match);
  }

  // Spaced / punctuated OCR: ABCDE 1234 F or ABCDE-1234-F
  for (const match of upper.match(/\b[A-Z]{5}[\s\-\.]*[0-9OISB]{4}[\s\-\.]*[A-Z]\b/g) || []) {
    const compact = match.replace(/[\s\-\.]/g, '');
    const normalized = normalizePan(compact);
    if (PAN_PATTERN.test(normalized)) candidates.push(normalized);
  }

  // OCR may read 8 as S/B — try alternate digit substitutions
  for (const match of upper.match(/\b[A-Z]{5}[0-9OISB]{4}[A-Z]\b/g) || []) {
    const variants = new Set([normalizePan(match)]);
    const chars = match.split('');
    for (let i = 5; i <= 8; i++) {
      if (chars[i] === 'S') {
        const c = chars.slice();
        c[i] = '8';
        variants.add(normalizePan(c.join('')));
        c[i] = '5';
        variants.add(normalizePan(c.join('')));
      }
      if (chars[i] === 'B') {
        const c = chars.slice();
        c[i] = '8';
        variants.add(normalizePan(c.join('')));
      }
    }
    for (const v of variants) {
      if (PAN_PATTERN.test(v)) candidates.push(v);
    }
  }

  // Leading O misread as 0: 0KYPS8136M
  for (const match of upper.match(/\b[A-Z0]{5}[0-9]{4}[A-Z]\b/g) || []) {
    const normalized = normalizePan(match);
    if (PAN_PATTERN.test(normalized)) candidates.push(normalized);
  }

  return [...new Set(candidates)];
}

module.exports = { validatePan, extractPanNumbers, normalizePan, PAN_PATTERN };

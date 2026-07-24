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
  const scored = [];

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

  // Dark-ink / noisy strip: prefer 10-char windows needing few substitutions,
  // especially near PANINK marker or with 4th-char entity type P/C/H/F/A/T.
  const digitMap = { O: '0', I: '1', L: '1', Z: '2', S: '5', B: '8', G: '6', E: '6' };
  const preferNoise =
    /PANINK|PANLINE|PERMANENT|ACCOUNT\s*NUMBER|PEMANENT/i.test(text)
      ? upper
      : '';
  const noiseSources = preferNoise
    ? [preferNoise, upper]
    : [upper];

  for (const src of noiseSources) {
    const compact = src.replace(/[^A-Z0-9]/g, '');
    for (let i = 0; i <= compact.length - 10; i++) {
      const windows = [compact.slice(i, i + 10)];
      if (i + 11 <= compact.length) {
        const eleven = compact.slice(i, i + 11);
        // Drop one mid char (OCR insert) to form a 10-char PAN window
        for (let drop = 5; drop <= 9; drop++) {
          windows.push(eleven.slice(0, drop) + eleven.slice(drop + 1));
        }
      }

      for (const slice of windows) {
        if (slice.length !== 10) continue;
        if (!/^[A-Z]{5}/.test(slice) || !/[A-Z]$/.test(slice)) continue;
        const entity = slice[3];
        if (!/[PCHFATBLJG]/.test(entity)) continue;

        let subs = 0;
        let digits = '';
        let ok = true;
        for (let j = 5; j <= 8; j++) {
          const ch = slice[j];
          if (/[0-9]/.test(ch)) {
            digits += ch;
          } else if (digitMap[ch]) {
            digits += digitMap[ch];
            subs += 1;
          } else {
            ok = false;
            break;
          }
        }
        if (!ok || digits.length !== 4) continue;
        const realDigits = slice.slice(5, 9).replace(/[^0-9]/g, '').length;
        // Allow 1 real digit for PANINK strips (security pattern eats digits)
        const minReal = /PANINK|PANLINE/.test(src) ? 1 : 2;
        if (realDigits < minReal) continue;

        const candidate = normalizePan(slice.slice(0, 5) + digits + slice[9]);
        if (!PAN_PATTERN.test(candidate)) continue;

        let score = 40 - subs * 8 + realDigits * 5;
        if (entity === 'P') score += 15;
        if (/PANINK|PANLINE/.test(src)) score += 20;
        // Prefer check digit that isn't an OCR digit-confusion letter
        if (!digitMap[slice[9]]) score += 10;
        // Prefer letter-prefix + trailing digits in the mid quartet (e.g. BE35)
        if (/^[A-Z]{0,2}[0-9]{2,4}$/.test(slice.slice(5, 9))) score += 15;
        scored.push({ pan: candidate, score, subs });
      }
    }
    if (scored.some((s) => s.score >= 70)) break;
  }

  scored.sort((a, b) => b.score - a.score || a.subs - b.subs);
  // Prefer a single best noisy candidate (avoid flooding with near-misses)
  if (scored.length && scored[0].score >= 40) {
    candidates.push(scored[0].pan);
    // Include runner-up only if clearly competitive and different
    if (scored[1] && scored[1].score >= scored[0].score - 5 && scored[1].pan !== scored[0].pan) {
      candidates.push(scored[1].pan);
    }
  }

  return [...new Set(candidates)];
}

module.exports = { validatePan, extractPanNumbers, normalizePan, PAN_PATTERN };

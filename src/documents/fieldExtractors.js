const { validatePan } = require('../validators/pan');

const GOVT_STOP =
  /\b(INCOME|TAX|DEPARTMENT|DEPARTME|DEPAKIMENT|GOVT|GOVERNMENT|OF|INDIA|PAN|PERMANENT|ACCOUNT|NUMBER|CARD|AADHAAR|UIDAI|ADDRESS|GENDER|YEAR|BIRTH|DOB|MALE|FEMALE|FATHER|SIGNATURE|AUTHORITY|UNIQUE|IDENTIFICATION|DATE|ISSUE|YOURSELF|ELECTRONICALLY|GENERATED|DOWNLOAD|VID|ENROLLMENT|CAMSCANNER|SCANNED|NAME|FATHERS)\b/i;

const GARBAGE_WORDS = new Set([
  'COLD', 'NE', 'CAR', 'OR', 'ER', 'TEW', 'HS', 'AY', 'GGA', 'AIT', 'LADY', 'LADI',
  'THE', 'AND', 'FOR', 'WITH', 'FROM', 'THIS', 'THAT', 'CARD', 'SCANNED', 'HELLO',
  'SEE', 'EEE', 'BEET', 'BE', 'AT', 'IS', 'AN', 'TO', 'ON', 'BY', 'NAME',
  'APPLE', 'ORANGE', 'LAPTOP', 'BACKEND', 'FASTAPI', 'NODEJS', 'RANDOM', 'PERSON',
  'MG', 'ROAD', 'BENGALURU', 'KARNATAKA', 'NOTES', 'MEETING', 'DISCUSSION',
  'RY', 'CAMSCANNER', 'SPIES', 'REIS', 'SESH', 'DL', 'GE', 'GEE', 'TI', 'TT',
  'PERM', 'ANENT', 'ACC', 'COUNT', 'NUM', 'BER', 'GOVT', 'INDIA', 'TAX',
  'CO', 'FI', 'NS', 'SB', 'LAR', 'HIYA', 'AYE',
  'INCOMETAXDEPAKIMENT', 'INCOMETAXDEPARTMENT', 'INCOMETAX', 'GOVERNMENTOFINDIA',
  'PERMANENT', 'ACCOUNT', 'NUMBER', 'DEPARTMENT',
]);

function isFusedGovtToken(token) {
  return /INCOME|TAX|DEPART|GOVT|GOVERNMENT|PERMANENT|ACCOUNT|AADHAAR|UIDAI|CAMSCANNER|ANENT/i.test(
    token
  );
}

/** Fragmented OCR of "Permanent Account Number" etc. */
function looksLikeGovtPhrase(name) {
  const compact = name.replace(/\s+/g, '');
  return /PERM|ANENT|ACCOUNT|NUMBER|INCOME|TAXDEPT|GOVTOF|PERMANENTACCOUNT/i.test(compact);
}

function isGarbageToken(token) {
  if (!token || token.length === 0) return true;
  if (GARBAGE_WORDS.has(token)) return true;
  if (isFusedGovtToken(token)) return true;
  if (/^(.)\1{2,}$/.test(token)) return true;
  const counts = {};
  for (const ch of token) counts[ch] = (counts[ch] || 0) + 1;
  const maxRepeat = Math.max(...Object.values(counts));
  if (token.length >= 3 && maxRepeat / token.length >= 0.75) return true;
  if (token.length <= 3 && /^[AEIOU]+$/.test(token)) return true;
  if (token.length >= 4 && !/[AEIOU]/.test(token)) return true;
  // Extremely long fused OCR blobs
  if (token.length > 18) return true;
  return false;
}

function looksLikeRealName(name) {
  if (!name) return false;
  const parts = name.split(/\s+/);
  if (parts.length < 2) return false;
  const solid = parts.filter((p) => p.length >= 4 && !isGarbageToken(p));
  if (solid.length === 0) return false;
  const garbageCount = parts.filter((p) => isGarbageToken(p)).length;
  if (garbageCount >= parts.length - 1 && parts.length >= 2) return false;
  const junky = parts.filter(
    (p) => p.length <= 3 || /^(.)\1+$/.test(p) || /^[AEIOUY]+$/.test(p)
  ).length;
  if (junky >= Math.ceil(parts.length * 0.6)) return false;
  if (/NAME|FATHER|INCOME|TAX|GOVT|CAMSCANNER/i.test(name)) return false;
  if (looksLikeGovtPhrase(name)) return false;
  return true;
}

/**
 * @param {string} text
 * @param {{ words?: Array, excludeNames?: string[] }} [options]
 */
function extractPersonName(text, options = {}) {
  const words = options.words || [];
  const exclude = new Set((options.excludeNames || []).map((n) => String(n).toUpperCase()));
  let candidates = collectNameCandidates(text, words).filter((c) => !exclude.has(c.value));

  for (const ex of exclude) {
    candidates = candidates.filter((c) => {
      if (c.value === ex) return false;
      if (ex.includes(c.value) || c.value.includes(ex)) return false;
      return true;
    });
  }

  const upper = text.toUpperCase();
  const fatherIdx = upper.search(/FATHER'?S?\s*NAME|पिता/);
  const dobIdx = upper.search(/\d{2}[\/\-.]\d{2}[\/\-.]\d{4}/);
  const panIdx = upper.search(/\b[A-Z]{5}[0-9OISB]{4}[A-Z]\b/);

  for (const c of candidates) {
    const pos = upper.indexOf(c.value);
    c.pos = pos >= 0 ? pos : 99999;
    c.beforeFather = fatherIdx > 0 && c.pos < fatherIdx;
    c.beforeDob = dobIdx > 0 && c.pos < dobIdx && c.pos >= 0;
    c.afterPan = panIdx >= 0 && c.pos > panIdx;
    c.isInitialSurname = /^[A-Z]\s+[A-Z]{3,}$/.test(c.value);
  }

  // Demote the later name after PAN when Father label / DOB are missing
  // (common CamScanner OCR miss on those labels)
  const anchor = fatherIdx > 0 ? fatherIdx : dobIdx > 0 ? dobIdx : upper.length;
  const afterPanNames = candidates
    .filter((c) => c.afterPan && c.pos < anchor && looksLikeRealName(c.value))
    .sort((a, b) => a.pos - b.pos);
  if (afterPanNames.length >= 2 && fatherIdx < 0) {
    afterPanNames[afterPanNames.length - 1].likelyFather = true;
  } else if (fatherIdx < 0 && dobIdx > 0) {
    const beforeDob = candidates.filter((c) => c.beforeDob).sort((a, b) => a.pos - b.pos);
    if (beforeDob.length >= 2) beforeDob[beforeDob.length - 1].likelyFather = true;
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const boost = (c) =>
      (c.beforeFather ? 50 : 0) +
      (c.beforeDob ? 25 : 0) +
      (c.afterPan ? 15 : 0) +
      (c.isInitialSurname ? 35 : 0) +
      (c.source === 'after-pan' || c.source === 'after-pan-line' ? 25 : 0) +
      (c.likelyFather ? -80 : 0) +
      // Prefer earlier on the card
      Math.max(0, 30 - Math.floor((c.pos || 0) / 40));
    return scoreName(b.value, b) + boost(b) - (scoreName(a.value, a) + boost(a));
  });

  for (const cand of candidates) {
    if (cand.likelyFather) continue;
    if (scoreName(cand.value, cand) >= 25 && looksLikeRealName(cand.value)) {
      return cand.value;
    }
  }
  // Fallback if all marked likelyFather
  for (const cand of candidates) {
    if (scoreName(cand.value, cand) >= 25 && looksLikeRealName(cand.value)) {
      return cand.value;
    }
  }
  return null;
}

function wordConfidenceMap(words) {
  const map = new Map();
  for (const w of words) {
    const key = String(w.text || '')
      .replace(/[^A-Za-z]/g, '')
      .toUpperCase();
    if (!key) continue;
    const conf = w.confidence || 0;
    if (!map.has(key) || map.get(key) < conf) map.set(key, conf);
  }
  return map;
}

/** Name label that is NOT "Father's Name" */
const PERSON_NAME_LABEL =
  /(?<!Father'?s?\s)(?<!पिता[^\n]{0,20})(?:\bName\b|नाम)/gi;

function collectNameCandidates(text, words = []) {
  const found = [];
  const seen = new Set();
  const confMap = wordConfidenceMap(words);

  function add(raw, meta = {}) {
    const cleaned = cleanName(raw);
    if (!cleaned || seen.has(cleaned)) return;
    if (!looksLikeRealName(cleaned) && !meta.allowWeak) return;
    seen.add(cleaned);
    const parts = cleaned.split(/\s+/);
    const confs = parts.map((p) => confMap.get(p)).filter((c) => c != null);
    const avgConf =
      confs.length > 0 ? confs.reduce((a, b) => a + b, 0) / confs.length : null;
    found.push({ value: cleaned, avgConf, ...meta });
  }

  // Title Case names (common on Aadhaar OCR): "Subhash Singh"
  for (const m of text.matchAll(/\b([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{1,}){1,3})\b/g)) {
    add(m[1], { labeled: false, source: 'title-case', allowWeak: true });
  }

  // Labeled person Name / नाम — exclude Father's Name via lookbehind-alternatives
  const labelHits = [...text.matchAll(/(?:^|\n|[^\w])(?:Name|नाम)\s*[:\-\/>|.]?\s*([^\n]{0,80})/gi)];
  for (const m of labelHits) {
    const idx = m.index ?? 0;
    const before = text.slice(Math.max(0, idx - 24), idx).toUpperCase();
    if (/FATHER|PITA|पिता/.test(before)) continue;

    const window = text.slice(idx, idx + 140);
    for (const run of window.match(/\b[A-Z]{2,}(?:\s+[A-Z]{1,}){1,4}\b/g) || []) {
      add(run, { labeled: true, source: 'label' });
    }
    // Title-case in window
    for (const run of window.match(/\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{1,}){1,3}\b/g) || []) {
      add(run, { labeled: true, source: 'label-title' });
    }
    const direct = String(m[1] || '')
      .split(/\n/)[0]
      .replace(/[^A-Za-z\s]/g, ' ')
      .trim();
    if (direct && !/^name$/i.test(direct)) add(direct, { labeled: true, source: 'label-direct' });
  }

  // Name immediately before Aadhaar/PAN digits or DOB
  for (const m of text.matchAll(
    /\b([A-Z][A-Za-z]*(?:\s+[A-Z][A-Za-z]*){1,4})\s*(?=\d{4}|\d{2}[\/\-.]\d{2}|DOB)/g
  )) {
    add(m[1], { labeled: false, source: 'before-id' });
  }

  // Line after person Name label
  const lines = text.split(/\n/);
  for (let i = 0; i < lines.length; i++) {
    if (/(?:Name|नाम)\b/i.test(lines[i]) && !/Father|पिता/i.test(lines[i])) {
      const same = lines[i].replace(/^.*?(?:Name|नाम)\s*[:\-\/>|.]?\s*/i, '');
      if (same.trim() && !/^name$/i.test(same.trim())) {
        add(same, { labeled: true, source: 'same-line' });
      }
      if (lines[i + 1] && !/Father|पिता|DOB|Date/i.test(lines[i + 1])) {
        add(lines[i + 1], { labeled: true, source: 'next-line' });
      }
    }
  }

  // Name often sits between PAN number and Father's Name / DOB
  const afterPan = text.match(
    /\b[A-Z]{5}[0-9OISB]{4}[A-Z]\b([\s\S]{0,220}?)(?:Father|पिता|Date\s*of\s*Birth|DOB|जन्म)/i
  );
  if (afterPan) {
    for (const run of afterPan[1].match(/\b[A-Z]{2,}(?:\s+[A-Z]{1,}){1,4}\b/g) || []) {
      add(run, { labeled: true, source: 'after-pan' });
    }
    // Also: first substantial title/upper name line in the window
    const lines = afterPan[1].split(/\n/).map((l) => l.trim()).filter(Boolean);
    for (const line of lines.slice(0, 4)) {
      if (/Father|पिता|DOB|Date|Signature|जन्म/i.test(line)) break;
      add(line, { labeled: true, source: 'after-pan-line' });
    }
  }

  // "D MANIKANDAN" style before DOB on same visual block
  for (const m of text.matchAll(
    /\b([A-Z](?:\s+[A-Z]{2,}){1,3})\s+(?:[A-Z]{2,}(?:\s+[A-Z]+){0,3}\s+)?(\d{2}[\/\-.]\d{2}[\/\-.]\d{4})/g
  )) {
    add(m[1], { labeled: true, source: 'before-dob' });
  }

  // All multi-word uppercase runs (lowest priority)
  for (const run of text.toUpperCase().match(/\b[A-Z]{2,}(?:\s+[A-Z]{1,}){1,4}\b/g) || []) {
    add(run, { labeled: false, source: 'scan' });
  }

  return found;
}

function cleanName(raw) {
  if (!raw) return null;
  let parts = String(raw)
    .replace(/[^A-Za-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
    .split(' ')
    .filter(Boolean);

  while (parts.length && (GOVT_STOP.test(parts[0]) || isGarbageToken(parts[0]))) parts.shift();
  while (
    parts.length &&
    (GOVT_STOP.test(parts[parts.length - 1]) || isGarbageToken(parts[parts.length - 1]))
  ) {
    parts.pop();
  }

  parts = parts.filter((p) => !GOVT_STOP.test(p) && !isGarbageToken(p));
  parts = trimNameParts(parts);
  if (parts.length < 2) return null;

  const name = parts.join(' ');
  if (name.length < 5 || name.length > 60) return null;
  if (validatePan(name.replace(/\s/g, '')).valid) return null;
  return name;
}

function trimNameParts(parts) {
  const kept = [];
  for (const p of parts) {
    if (isGarbageToken(p)) {
      if (kept.length >= 2) break;
      continue;
    }
    // Stop before likely father's name when we already have First + Last
    // e.g. "D MANIKANDAN TI DURAISAMY" → "D MANIKANDAN"
    if (kept.length >= 2 && p.length <= 2 && !/^[A-Z]$/.test(p)) break;
    if (kept.length >= 3 && kept[kept.length - 1].length === 1) break;
    if (kept.length >= 3 && p.length < 5) break;
    if (kept.length >= 2 && p.length >= 2 && p.length <= 3 && !/[AEIOU]/.test(p)) break;
    if (kept.length >= 2 && p.length > 1 && !/[AEIOU]/.test(p)) break;

    kept.push(p);
    // Typical PAN name: initial + surname OR first + last (+ optional initial)
    if (kept.length >= 2 && kept[0].length === 1 && kept[1].length >= 4) break;
    if (kept.length >= 4) break;
  }
  return kept;
}

function scoreName(name, meta = {}) {
  const parts = name.split(/\s+/);
  let score = parts.length * 12 + Math.min(name.length, 30);

  if (meta.labeled) score += 45;
  if (meta.source === 'label' || meta.source === 'label-direct' || meta.source === 'same-line') {
    score += 15;
  }
  if (meta.source === 'title-case' || meta.source === 'label-title') score += 35;
  if (meta.source === 'before-id' || meta.source === 'after-pan' || meta.source === 'before-dob' || meta.source === 'after-pan-line') {
    score += 30;
  }
  if (meta.source === 'next-line') score += 20;
  if (meta.source === 'scan') score -= 15;
  if (looksLikeGovtPhrase(name)) score -= 60;

  if (meta.avgConf != null) {
    if (meta.avgConf >= 70) score += 20;
    else if (meta.avgConf >= 50) score += 8;
    else if (meta.avgConf < 35) score -= 25;
  }

  for (const p of parts) {
    if (isGarbageToken(p)) score -= 30;
    if (p.length === 1) score += 3;
    else if (p.length === 2) score -= 8;
    else if (p.length >= 4) score += 12;
    else score += 2;

    if (p.length > 1 && !/[AEIOU]/.test(p)) score -= 12;
    if (/^(.)\1{2,}$/.test(p)) score -= 40;
  }

  if (parts.length >= 3) score += 15;
  if (parts.length === 2 && parts.every((p) => p.length >= 4)) score += 15;
  if (!looksLikeRealName(name)) score -= 40;

  return score;
}

function extractFatherName(text, options = {}) {
  const words = options.words || [];
  const confMap = wordConfidenceMap(words);

  const m = text.match(
    /(?:Father'?s?\s*Name|पिता[^\nA-Z]{0,30}|Name\s*N)\s*[:\-\/>]?\s*([A-Z][A-Za-z]*(?:\s+[A-Z][A-Za-z]*){0,4})/i
  );

  // Fallback: on PAN cards, second real name after PAN number is usually father
  if (!m) {
    const panMatch = text.match(/\b[A-Z]{5}[0-9OISB]{4}[A-Z]\b/i);
    const dobIdx = text.search(/\d{2}[\/\-.]\d{2}[\/\-.]\d{4}/);
    if (panMatch) {
      const start = (panMatch.index || 0) + panMatch[0].length;
      const end = dobIdx > start ? dobIdx : Math.min(text.length, start + 280);
      const window = text.slice(start, end);
      const runs = window.toUpperCase().match(/\b[A-Z]{2,}(?:\s+[A-Z]{1,}){1,4}\b/g) || [];
      const cleaned = [
        ...new Set(
          runs
            .map((r) => cleanName(r))
            .filter((n) => n && looksLikeRealName(n) && n.split(/\s+/).some((p) => p.length >= 4))
        ),
      ];
      if (cleaned.length >= 2) return cleaned[cleaned.length - 1];
    }
  }

  if (!m) return null;

  const idx = m.index ?? 0;
  const window = text.slice(idx, idx + 120);
  const candidates = [];

  function push(raw) {
    const cleaned = cleanName(raw);
    if (cleaned) candidates.push(cleaned);
  }

  for (const run of window.match(/\b[A-Z]{2,}(?:\s+[A-Z]{1,}){0,3}\b/g) || []) {
    push(run);
  }
  push(m[1]);

  const soft = String(m[1])
    .replace(/[^A-Za-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
  if (soft.length >= 4 && !GOVT_STOP.test(soft)) {
    const parts = soft.split(' ').filter((p) => !GOVT_STOP.test(p) && !isGarbageToken(p));
    if (parts.length >= 1 && parts.join(' ').length >= 4) candidates.push(parts.join(' '));
  }

  if (candidates.length === 0) return null;

  const unique = [...new Set(candidates)].filter(
    (n) => looksLikeRealName(n) || n.split(/\s+/).some((p) => p.length >= 5)
  );
  if (unique.length === 0) return null;

  unique.sort((a, b) => {
    const confA = a.split(/\s+/).map((p) => confMap.get(p) || 0);
    const confB = b.split(/\s+/).map((p) => confMap.get(p) || 0);
    const avgA = confA.reduce((x, y) => x + y, 0) / Math.max(confA.length, 1);
    const avgB = confB.reduce((x, y) => x + y, 0) / Math.max(confB.length, 1);
    return (
      scoreName(b, { labeled: true, avgConf: avgB }) -
      scoreName(a, { labeled: true, avgConf: avgA })
    );
  });
  return unique[0];
}

function extractDob(text) {
  const labeled = text.match(
    /(?:DOB|Date of Birth|जन्म[^\d]{0,24})\s*[:\-]?\s*(\d{1,2}[\/\-\.\s]\d{1,2}[\/\-\.\s]\d{4})/i
  );
  if (labeled) return normalizeDob(labeled[1]);

  const loose = text.match(/\b(\d{2})[\/\-\.\s](\d{2})[\/\-\.\s](\d{4})\b/);
  if (loose) {
    const day = parseInt(loose[1], 10);
    const month = parseInt(loose[2], 10);
    const year = parseInt(loose[3], 10);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 1900 && year <= 2100) {
      return `${loose[1]}/${loose[2]}/${loose[3]}`;
    }
  }
  return null;
}

function normalizeDob(raw) {
  return String(raw)
    .replace(/\s+/g, '/')
    .replace(/[.\-]+/g, '/')
    .replace(/\/+/g, '/');
}

function extractGender(text) {
  const m = text.match(/\b(MALE|FEMALE|TRANSGENDER)\b/i);
  return m ? m[1].toUpperCase() : null;
}

module.exports = {
  extractPersonName,
  extractFatherName,
  extractDob,
  extractGender,
  cleanName,
  scoreName,
  looksLikeRealName,
  isGarbageToken,
  PERSON_NAME_LABEL,
};

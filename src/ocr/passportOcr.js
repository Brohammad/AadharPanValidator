const { runOcrOnce } = require('./tesseract');
const { buildPassportRegionBuffers } = require('../preprocessing/passportRegions');
const { parseMrz, cleanMrzLine } = require('../shared/mrz');

const NUMBER_WHITELIST = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const MRZ_WHITELIST = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<';

/** ICAO 9303 check digit */
function mrzCheckDigit(str) {
  const weights = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < str.length; i++) {
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
 * Expand OCR confusions into plausible Indian passport numbers (1 letter + 7 digits).
 */
function expandPassportNumberCandidates(raw) {
  if (!raw) return [];
  const seed = String(raw).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (seed.length < 6 || seed.length > 12) return [];

  // Reject obvious MRZ date/sex fragments
  if (/^\d/.test(seed) || /[MF]\d{5}/.test(seed) || /^[MF]/.test(seed)) return [];

  const alts = {
    A: ['4', 'A'],
    S: ['5', 'S'],
    O: ['0', 'O'],
    Q: ['0'],
    D: ['0'],
    B: ['8'],
    Z: ['2'],
    G: ['6'],
    I: ['1'],
    L: ['1'],
    T: ['7'],
    E: ['3'],
  };

  const results = new Set();

  function walk(prefix, rest, depth) {
    if (results.size > 60) return;
    if (!rest.length) {
      if (/^[A-Z]\d{7}$/.test(prefix)) results.add(prefix);
      return;
    }
    // Keep length toward 8 total
    if (prefix.length > 8) return;
    const ch = rest[0];
    const choices = /\d/.test(ch) ? [ch] : alts[ch] || ( /[A-Z]/.test(ch) && prefix.length === 0 ? [ch] : []);
    if (prefix.length === 0) {
      // First char must stay a letter
      if (/[A-Z]/.test(ch)) walk(ch, rest.slice(1), depth + 1);
      return;
    }
    for (const c of choices) {
      if (prefix.length >= 1 && !/\d/.test(c) && c !== '') continue;
      walk(prefix + c, rest.slice(1), depth + 1);
    }
    // Allow skipping garbage letters in the middle occasionally
    if (depth < 3 && /[A-Z]/.test(ch) && !alts[ch]) walk(prefix, rest.slice(1), depth + 1);
  }

  const starts = new Set([seed]);
  const m = seed.match(/[A-Z][A-Z0-9]{6,9}/);
  if (m) starts.add(m[0]);
  // Trim trailing non-digit noise letters after digit run
  const trimmed = seed.replace(/([A-Z]\d*[A-Z0-9]*?\d)[A-Z]+$/i, '$1');
  if (trimmed !== seed) starts.add(trimmed);

  for (const s of starts) walk('', s, 0);

  // Aggressive: first letter + map all ambiguous to digits
  if (/^[A-Z]/.test(seed)) {
    const letter = seed[0];
    const digitMap = { A: '4', S: '5', O: '0', Q: '0', D: '0', B: '8', Z: '2', G: '6', I: '1', L: '1', T: '7', E: '3' };
    const digits = seed
      .slice(1)
      .split('')
      .map((c) => (/\d/.test(c) ? c : digitMap[c] || ''))
      .join('');
    if (digits.length >= 7) results.add(letter + digits.slice(0, 7));
  }

  return [...results];
}

function collectRawNumberTokens(texts) {
  const tokens = [];
  for (const text of texts) {
    if (!text) continue;
    const upper = text.toUpperCase().replace(/[^A-Z0-9\n]/g, '');
    for (const m of upper.matchAll(/[A-Z][A-Z0-9]{5,10}/g)) {
      if (/\d/.test(m[0]) && !/^[MF]/.test(m[0]) && !/^\d/.test(m[0])) tokens.push(m[0]);
    }
  }
  return [...new Set(tokens)];
}

/**
 * Only trust MRZ check digit when line-2 shaped: NNNNNNNNNC or NNNNNNNNN<C
 */
function extractTrustedCheckDigit(texts) {
  const blob = texts.join('\n').toUpperCase();
  // U5544054<7IND...
  let m = blob.match(/\b([A-Z]\d{7})<?([0-9])IND/);
  if (m) return { number: m[1], checkDigit: m[2] };
  m = blob.match(/\b([A-Z]\d{7})<([0-9])[A-Z]{3}/);
  if (m) return { number: m[1], checkDigit: m[2] };

  for (const line of blob.split(/\n/)) {
    const cleaned = cleanMrzLine(line);
    if (cleaned.length >= 44 && /^[A-Z][A-Z0-9<]{8}/.test(cleaned)) {
      const num = cleaned.slice(0, 9).replace(/</g, '');
      const cd = cleaned[9];
      if (/^[A-Z]\d{7}$/.test(num) && /\d/.test(cd)) return { number: num, checkDigit: cd };
    }
  }
  return { number: null, checkDigit: null };
}

function scorePassportNumberCandidate(num, context) {
  let score = 0;
  if (!/^[A-Z]\d{7}$/.test(num)) return -100;

  score += 40;
  if (/^[UZVSJT]/.test(num)) score += 15;

  // Exact OCR hit is decisive (threshold pass often reads the number cleanly)
  if (context.exactHits?.has(num)) score += 200;

  if (context.trustedNumber === num) score += 100;
  if (context.checkDigit && mrzCheckDigit(num) === context.checkDigit) score += 80;

  if (context.aConfusionHits?.has(num)) score += 35;

  // Soft digit overlap — capped so it cannot beat an exact hit
  let fuzzy = 0;
  const digits = num.slice(1);
  for (const raw of context.rawTokens || []) {
    const rawDigits = raw
      .slice(1)
      .replace(/[A-Z]/g, (c) => ({ A: '4', S: '5', O: '0', T: '7' }[c] || ''));
    if (!rawDigits) continue;
    let match = 0;
    for (let i = 0; i < Math.min(digits.length, rawDigits.length); i++) {
      if (digits[i] === rawDigits[i]) match++;
    }
    fuzzy += match;
  }
  score += Math.min(fuzzy, 12) * 2;

  if (/(.)\1{3,}/.test(num)) score -= 30;
  if (/5555|0000|4444|5554{2}/.test(num)) score -= 15;

  return score;
}

function pickBestPassportNumber(texts, mrzText = '') {
  const allTexts = [...texts, mrzText].filter(Boolean);
  const rawTokens = collectRawNumberTokens(allTexts);
  const exactHits = new Set(rawTokens.filter((t) => /^[A-Z]\d{7}$/.test(t)));
  const candidates = new Set([...exactHits]);
  const aConfusionHits = new Set();

  for (const t of rawTokens) {
    for (const c of expandPassportNumberCandidates(t)) {
      candidates.add(c);
      if (/A/.test(t) && c.includes('4')) aConfusionHits.add(c);
    }
    if (/^[A-Z]/.test(t) && /A/.test(t)) {
      const digits = t
        .slice(1)
        .replace(/A/g, '4')
        .replace(/S/g, '5')
        .replace(/O/g, '0')
        .replace(/[^0-9]/g, '');
      if (digits.length >= 7) {
        const n = t[0] + digits.slice(0, 7);
        candidates.add(n);
        aConfusionHits.add(n);
      }
    }
  }

  const trusted = extractTrustedCheckDigit(allTexts);
  if (trusted.number) {
    candidates.add(trusted.number);
    exactHits.add(trusted.number);
  }

  const mrzParsed = parseMrz(allTexts.join('\n'));
  if (mrzParsed.fields?.passportNumber && /^[A-Z]\d{7}$/.test(mrzParsed.fields.passportNumber)) {
    candidates.add(mrzParsed.fields.passportNumber);
  }

  const ctx = {
    checkDigit: trusted.checkDigit,
    trustedNumber: trusted.number,
    rawTokens,
    aConfusionHits,
    exactHits,
  };

  let best = null;
  let bestScore = -Infinity;
  for (const c of candidates) {
    const s = scorePassportNumberCandidate(c, ctx);
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }

  // If we have exact OCR hits, never return a non-exact guess
  if (exactHits.size && best && !exactHits.has(best)) {
    best = [...exactHits][0];
    bestScore = scorePassportNumberCandidate(best, ctx);
  }

  return {
    passportNumber: bestScore >= 45 ? best : null,
    candidates: [...candidates],
    bestScore,
    checkDigit: trusted.checkDigit,
  };
}

let whitelistWorkerPromise = null;

async function getWhitelistWorker() {
  if (!whitelistWorkerPromise) {
    whitelistWorkerPromise = (async () => {
      const { createWorker } = require('tesseract.js');
      const path = require('path');
      const LANG_PATH = path.resolve(__dirname, '../..');
      return createWorker('eng', 1, {
        langPath: LANG_PATH,
        cachePath: LANG_PATH,
        logger: () => {},
      });
    })();
  }
  return whitelistWorkerPromise;
}

async function recognizeWhitelisted(buffer, whitelist, psm = '7') {
  if (!buffer) return { text: '', ocrConfidence: 0 };
  const worker = await getWhitelistWorker();
  await worker.setParameters({
    tessedit_char_whitelist: whitelist,
    tessedit_pageseg_mode: psm,
  });
  const result = await worker.recognize(buffer);
  const words = result.data.words || [];
  const confidences = words.filter((w) => w.confidence > 0).map((w) => w.confidence);
  const ocrConfidence =
    confidences.length > 0
      ? Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length)
      : Math.round(result.data.confidence || 0);
  return { text: result.data.text || '', ocrConfidence, words };
}

async function recognizeRegion(buffer, options = {}) {
  if (!buffer) return { text: '', ocrConfidence: 0 };
  return runOcrOnce(buffer, { tessedit_pageseg_mode: options.psm || '6' });
}

/**
 * Focused passport OCR. Prefer the original (uncropped) page buffer so ROI
 * fractions match the physical passport layout.
 * Skips ROI passes when base OCR already has a high-confidence MRZ + number.
 */
async function refinePassportOcr(ocrResult, pageBuffer) {
  const baseText = ocrResult?.text || '';
  const baseParsed = parseMrz(baseText);
  const baseNumber =
    (baseParsed.fields && baseParsed.fields.passportNumber) ||
    (baseText.toUpperCase().match(/\b([A-Z]\d{7})\b/) || [])[1];
  const baseHasStrongMrz =
    baseParsed.fields?.passportNumber &&
    baseParsed.mrz &&
    /P<[A-Z]{3}/.test(baseParsed.mrz) &&
    (ocrResult?.ocrConfidence || 0) >= 65;

  if (baseHasStrongMrz && baseNumber) {
    return {
      ...ocrResult,
      passportRefine: {
        skipped: true,
        reason: 'Base OCR already has high-confidence MRZ and passport number',
        passportNumber: baseNumber,
        mrz: baseParsed.mrz,
        mrzFields: baseParsed.fields,
      },
    };
  }

  const regions = await buildPassportRegionBuffers(pageBuffer);

  // If number already confident, skip dual number ROI variants (keep MRZ + header)
  const skipNumberRoi = !!(baseNumber && /^[A-Z]\d{7}$/.test(baseNumber) && (ocrResult?.ocrConfidence || 0) >= 60);

  const tasks = [
    recognizeRegion(regions.headerRight, { psm: '6' }),
    skipNumberRoi
      ? Promise.resolve({ text: '', ocrConfidence: 0 })
      : recognizeWhitelisted(regions.numberThresh, NUMBER_WHITELIST, '7'),
    skipNumberRoi
      ? Promise.resolve({ text: '', ocrConfidence: 0 })
      : recognizeWhitelisted(regions.numberNorm, NUMBER_WHITELIST, '7'),
    recognizeWhitelisted(regions.mrz, MRZ_WHITELIST, '6'),
  ];

  const [header, numberThresh, numberNorm, mrz] = await Promise.all(tasks);

  const numberTexts = [numberThresh.text, numberNorm.text, header.text];
  const mrzCombined = [mrz.text, ocrResult.text].join('\n');
  const numberPick = pickBestPassportNumber(
    [...numberTexts, ocrResult.text],
    mrzCombined
  );

  const mergedText = [
    ocrResult.text || '',
    '--- passport regions ---',
    header.text,
    ...numberTexts,
    mrz.text,
  ]
    .filter(Boolean)
    .join('\n');

  let mrzFields = parseMrz(mrzCombined).fields;
  let enrichedMrz = parseMrz(mrzCombined).mrz;
  if (numberPick.passportNumber) {
    const tail = cleanMrzLine(mrz.text);
    const dobSexExp = tail.match(/(\d{6})(\d)([MF<])(\d{6})/);
    const line1Match =
      cleanMrzLine(mrz.text).match(/P<[A-Z]{3}[A-Z<]+/) ||
      `${mergedText}`.toUpperCase().match(/P<[A-Z]{3}[A-Z<]+/);
    if (dobSexExp) {
      const line2 = `${numberPick.passportNumber}<${'IND'}${dobSexExp[1]}${dobSexExp[3]}${dobSexExp[4]}`.padEnd(
        44,
        '<'
      );
      const line1 = (line1Match ? line1Match[0] : 'P<IND').padEnd(44, '<').slice(0, 44);
      enrichedMrz = `${line1}\n${line2.slice(0, 44)}`;
      mrzFields = parseMrz(enrichedMrz).fields;
    }
  }

  return {
    ...ocrResult,
    text: mergedText,
    ocrConfidence: Math.max(
      ocrResult.ocrConfidence || 0,
      header.ocrConfidence || 0,
      numberThresh.ocrConfidence || 0,
      numberNorm.ocrConfidence || 0
    ),
    passportRefine: {
      passportNumber: numberPick.passportNumber,
      numberScore: numberPick.bestScore,
      checkDigit: numberPick.checkDigit,
      candidates: numberPick.candidates.slice(0, 15),
      mrz: enrichedMrz,
      mrzFields,
      regionTexts: {
        header: header.text,
        numberThresh: numberThresh.text,
        numberNorm: numberNorm.text,
        mrz: mrz.text,
      },
    },
  };
}

async function terminatePassportOcr() {
  if (!whitelistWorkerPromise) return;
  try {
    const worker = await whitelistWorkerPromise;
    await worker.terminate();
  } catch {
    // ignore
  }
  whitelistWorkerPromise = null;
}

module.exports = {
  refinePassportOcr,
  pickBestPassportNumber,
  expandPassportNumberCandidates,
  mrzCheckDigit,
  terminatePassportOcr,
};

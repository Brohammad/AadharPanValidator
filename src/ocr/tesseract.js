const path = require('path');
const { createWorker, createScheduler } = require('tesseract.js');
const config = require('../config');

const LANG_PATH = path.resolve(__dirname, '../..');
// English-only: eng+hin introduced diacritic noise on Latin PAN/Aadhaar fields
const OCR_LANG = 'eng';

const PSM_PRIMARY = [
  { name: 'single_block', tessedit_pageseg_mode: '6' },
  { name: 'auto', tessedit_pageseg_mode: '3' },
];
const PSM_FALLBACK = [{ name: 'sparse', tessedit_pageseg_mode: '11' }];

function goodEnoughScore(options = {}) {
  return options.goodEnoughScore ?? config.ocrGoodEnoughScore ?? 140;
}

function excellentScore() {
  return config.ocrExcellentScore ?? 200;
}

let schedulerPromise = null;

async function getScheduler() {
  if (!schedulerPromise) {
    schedulerPromise = (async () => {
      const scheduler = createScheduler();
      const workers = await Promise.all([
        createWorker(OCR_LANG, 1, { langPath: LANG_PATH, logger: () => {} }),
        createWorker(OCR_LANG, 1, { langPath: LANG_PATH, logger: () => {} }),
      ]);
      for (const worker of workers) {
        scheduler.addWorker(worker);
      }
      return scheduler;
    })();
  }
  return schedulerPromise;
}

async function runOcrOnce(imageBuffer, options = {}) {
  const scheduler = await getScheduler();
  const result = await scheduler.addJob('recognize', imageBuffer, {
    tessedit_pageseg_mode: options.tessedit_pageseg_mode || '6',
  });

  const words = result.data.words || [];
  const confidences = words
    .filter((w) => w.confidence > 0)
    .map((w) => w.confidence);

  const ocrConfidence =
    confidences.length > 0
      ? Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length)
      : 0;

  return {
    text: result.data.text || '',
    ocrConfidence,
    words,
    blocks: result.data.blocks || [],
    lines: result.data.lines || [],
    raw: result.data,
  };
}

function scoreOcrResult(result) {
  const text = result.text || '';
  const upper = text.toUpperCase();
  const alnum = (text.match(/[A-Za-z0-9]/g) || []).length;
  const conf = result.ocrConfidence || 0;

  // Empty / near-empty must never beat readable OCR just because confidence is high
  if (!text.trim() || alnum < 8) {
    return -100 + Math.min(conf, 20) * 0.1;
  }

  let score = conf * 0.4;

  if (/[A-Z]{5}[0-9OISB]{4}[A-Z]/.test(upper)) score += 80;
  if (/\b\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b/.test(text)) score += 80;
  if (/\bP<[A-Z]{3}|PASSPORT|REPUBLIC\s+OF|<<<</i.test(text)) score += 70;
  if (/\b[A-Z]\d{7}\b/.test(upper)) score += 50;
  if (/SURNAME|GIVEN\s*NAME|PLACE\s*OF\s*BIRTH|NATIONALITY/i.test(text)) score += 25;

  // Exact + fuzzy ID keywords (phone/PDF OCR often mashes words together)
  if (/INCOME\s*TAX|GOVT\.?\s*OF\s*INDIA|GOVERNMENT\s*OF\s*INDIA|आयकर|भारत\s*सरकार/i.test(text)) {
    score += 40;
  } else if (/INCOME|TAX\s*DEPART|DEFART|GOVT|GOVERNMENT/i.test(upper)) {
    score += 25;
  }
  if (
    /PERMANENT\s*ACCOUNT|AADHAAR|आधार|UIDAI|FATHER|पिता|DOB|MALE|FEMALE/i.test(text) ||
    /PEMANENT|PERM[A4]NENTACCOUNT|FATHERS?NAME|ACCOUNTNUMBER/i.test(upper)
  ) {
    score += 35;
  }
  if (/\bNAME\b|नाम|FATHERS?NAME/i.test(text)) score += 15;
  if (/\b(MALE|FEMALE)\b/i.test(text)) score += 25;
  if (/\d{2}[\/\-.]\d{2}[\/\-.]\d{4}/.test(text)) score += 25;
  if (/\b[A-Z]{2,}(?:\s+[A-Z]{1,}){1,3}\b/.test(upper)) score += 15;

  // CamScanner chrome alone is not a successful ID read
  if (/CAMSCANNER|SCANNED\s*BY/i.test(upper)) {
    const hasId =
      /[A-Z]{5}[0-9OISB]{4}[A-Z]/.test(upper) ||
      /\d{4}[\s\-]?\d{4}[\s\-]?\d{4}/.test(text) ||
      /INCOME|AADHAAR|GOVT|PAN|UIDAI|FATHER|PEMANENT|ACCOUNT/i.test(upper);
    if (!hasId) score -= 80;
    else score -= 10;
  }

  const symbols = (text.match(/[^A-Za-z0-9\s]/g) || []).length;
  const total = Math.max(text.length, 1);
  if (symbols / total > 0.25) score -= 40;

  const tokens = text.split(/\s+/).filter(Boolean);
  const shortRatio = tokens.filter((t) => t.length <= 2).length / Math.max(tokens.length, 1);
  const longWords = tokens.filter((t) => /[A-Za-z]{5,}/.test(t)).length;

  // Prefer readable long tokens over high-alnum noise soup
  if (alnum < 25) score -= 50;
  else if (alnum < 40) score -= 15;
  else if (longWords >= 3) score += Math.min(20, longWords * 2);
  else score += Math.min(10, alnum / 40);

  if (shortRatio > 0.55 && tokens.length > 30) score -= 35;
  // Low-confidence walls of alnum with few real words = noise
  if (conf < 40 && alnum > 800 && longWords < 5) score -= 50;
  if (conf < 35 && symbols / total > 0.15 && longWords < 4) score -= 25;

  return score;
}

/**
 * Orientation probe score — readability only, no ID-pattern bonuses.
 * ID bonuses (PAN/Aadhaar digit runs) fire on sideways garbage and flip pages.
 */
function scoreOrientationProbe(result) {
  const text = result.text || '';
  const conf = result.ocrConfidence || 0;
  const alnum = (text.match(/[A-Za-z0-9]/g) || []).length;
  const letters = (text.match(/[A-Za-z]/g) || []).length;
  const symbols = (text.match(/[^A-Za-z0-9\s]/g) || []).length;
  const total = Math.max(text.length, 1);
  const tokens = text.split(/\s+/).filter(Boolean);
  const shortRatio = tokens.filter((t) => t.length <= 2).length / Math.max(tokens.length, 1);
  const longWords = tokens.filter((t) => /[A-Za-z]{4,}/.test(t)).length;

  let score = conf * 0.5 + Math.min(alnum, 400) * 0.15 + longWords * 2;
  if (symbols / total > 0.2) score -= 50;
  if (shortRatio > 0.5 && tokens.length > 20) score -= 60;
  if (letters < 40) score -= 25;
  // Readable document words (not ID-specific digit patterns)
  if (
    /SECURITY|PROGRAMME|PROGRAM|CLEARANCE|CERTIFICATE|COMPANY|AUTHORITY|ORGANI[SZ]ATION|DOCUMENT|VERSION|EMPLOYEE|VALID/i.test(
      text
    )
  ) {
    score += 35;
  }
  return score;
}

async function runOcrModes(imageBuffer, modes, options = {}) {
  let best = null;
  let bestScore = -Infinity;
  const enough = goodEnoughScore(options);

  for (const mode of modes) {
    try {
      const result = await runOcrOnce(imageBuffer, {
        tessedit_pageseg_mode: mode.tessedit_pageseg_mode,
      });
      const score = scoreOcrResult(result);
      if (score > bestScore) {
        bestScore = score;
        best = result;
      }
      if (score >= enough) break;
    } catch {
      // try next mode
    }
  }

  return { result: best, score: bestScore };
}

async function runOcr(imageBuffer, options = {}) {
  const modes = options.fast
    ? [{ name: 'single_block', tessedit_pageseg_mode: '6' }]
    : PSM_PRIMARY;

  const primary = await runOcrModes(imageBuffer, modes, options);
  if (options.fast) {
    return (
      primary.result || {
        text: '',
        ocrConfidence: 0,
        words: [],
        blocks: [],
        lines: [],
        raw: {},
      }
    );
  }

  if (primary.score >= goodEnoughScore(options)) {
    return primary.result;
  }

  const fallback = await runOcrModes(imageBuffer, PSM_FALLBACK, options);
  if (fallback.score > primary.score) return fallback.result;
  return (
    primary.result || {
      text: '',
      ocrConfidence: 0,
      words: [],
      blocks: [],
      lines: [],
      raw: {},
    }
  );
}

async function runOcrOnPages(ocrBuffers, ocrVariantsList = null, options = {}) {
  const pageResults = [];
  const maxVariants = options.maxVariants || Infinity;
  const fast = Boolean(options.fast);
  const goodEnough = goodEnoughScore(options);
  const excellent = options.excellentScore ?? excellentScore();

  for (let i = 0; i < ocrBuffers.length; i++) {
    const variants = (
      ocrVariantsList && ocrVariantsList[i] && ocrVariantsList[i].length
        ? ocrVariantsList[i]
        : [ocrBuffers[i]]
    ).slice(0, maxVariants);

    let best = null;
    let bestScore = -Infinity;

    for (const variant of variants) {
      const result = await runOcr(variant, { fast, goodEnoughScore: goodEnough });
      const score = scoreOcrResult(result);
      if (score > bestScore) {
        bestScore = score;
        best = result;
      }
      if (score >= excellent) break;
      if (score >= goodEnough && best?.ocrConfidence >= 55) break;
      // Fast path: accept first decent read
      if (fast && best?.ocrConfidence >= 60 && (best.text || '').trim().length > 40) break;
    }

    pageResults.push(
      best || { text: '', ocrConfidence: 0, words: [], blocks: [], lines: [], raw: {} }
    );
  }

  const combinedText = pageResults.map((p) => p.text).join('\n\n');
  const avgConfidence =
    pageResults.length > 0
      ? Math.round(
          pageResults.reduce((sum, p) => sum + p.ocrConfidence, 0) / pageResults.length
        )
      : 0;

  return {
    text: combinedText,
    ocrConfidence: avgConfidence,
    pages: pageResults,
    words: pageResults[0]?.words || [],
    lines: pageResults[0]?.lines || [],
  };
}

async function terminateOcr() {
  if (!schedulerPromise) return;
  try {
    const scheduler = await schedulerPromise;
    await scheduler.terminate();
  } catch {
    // ignore
  }
  schedulerPromise = null;
  try {
    const { terminatePassportOcr } = require('./passportOcr');
    await terminatePassportOcr();
  } catch {
    // ignore
  }
}

module.exports = {
  runOcr,
  runOcrOnPages,
  runOcrOnce,
  scoreOcrResult,
  scoreOrientationProbe,
  terminateOcr,
  GOOD_ENOUGH_SCORE: config.ocrGoodEnoughScore,
};

const path = require('path');
const { createWorker, createScheduler } = require('tesseract.js');

const LANG_PATH = path.resolve(__dirname, '../..');
// English-only: eng+hin introduced diacritic noise on Latin PAN/Aadhaar fields
const OCR_LANG = 'eng';

const PSM_PRIMARY = [
  { name: 'single_block', tessedit_pageseg_mode: '6' },
  { name: 'auto', tessedit_pageseg_mode: '3' },
];
const PSM_FALLBACK = [{ name: 'sparse', tessedit_pageseg_mode: '11' }];

const GOOD_ENOUGH_SCORE = 140;
const EXCELLENT_SCORE = 200;

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
  let score = result.ocrConfidence * 0.4;

  if (/[A-Z]{5}[0-9OISB]{4}[A-Z]/.test(upper)) score += 80;
  if (/\b\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b/.test(text)) score += 80;
  if (/INCOME\s*TAX|GOVT\.?\s*OF\s*INDIA|GOVERNMENT\s*OF\s*INDIA|आयकर|भारत\s*सरकार/i.test(text)) {
    score += 40;
  }
  if (/PERMANENT\s*ACCOUNT|AADHAAR|आधार|UIDAI|FATHER|पिता|DOB|MALE|FEMALE/i.test(text)) {
    score += 30;
  }
  if (/\bNAME\b|नाम/i.test(text)) score += 15;
  if (/\b(MALE|FEMALE)\b/i.test(text)) score += 25;
  if (/\d{2}[\/\-.]\d{2}[\/\-.]\d{4}/.test(text)) score += 25;
  if (/\b[A-Z]{2,}(?:\s+[A-Z]{1,}){1,3}\b/.test(upper)) score += 15;

  // CamScanner chrome alone is not a successful ID read
  if (/CAMSCANNER|SCANNED\s*BY/i.test(upper)) {
    const hasId =
      /[A-Z]{5}[0-9OISB]{4}[A-Z]/.test(upper) ||
      /\d{4}[\s\-]?\d{4}[\s\-]?\d{4}/.test(text) ||
      /INCOME|AADHAAR|GOVT|PAN|UIDAI/i.test(upper);
    if (!hasId) score -= 80;
    else score -= 10;
  }

  const alnum = (text.match(/[A-Za-z0-9]/g) || []).length;
  const symbols = (text.match(/[^A-Za-z0-9\s]/g) || []).length;
  const total = Math.max(text.length, 1);
  if (symbols / total > 0.25) score -= 40;
  if (alnum < 20) score -= 30;

  const tokens = text.split(/\s+/).filter(Boolean);
  const shortRatio = tokens.filter((t) => t.length <= 2).length / Math.max(tokens.length, 1);
  if (shortRatio > 0.55 && tokens.length > 30) score -= 35;

  return score;
}

async function runOcrModes(imageBuffer, modes) {
  let best = null;
  let bestScore = -Infinity;

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
      if (score >= GOOD_ENOUGH_SCORE) break;
    } catch {
      // try next mode
    }
  }

  return { result: best, score: bestScore };
}

async function runOcr(imageBuffer) {
  const primary = await runOcrModes(imageBuffer, PSM_PRIMARY);
  if (primary.score >= GOOD_ENOUGH_SCORE) {
    return primary.result;
  }

  const fallback = await runOcrModes(imageBuffer, PSM_FALLBACK);
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

async function runOcrOnPages(ocrBuffers, ocrVariantsList = null) {
  const pageResults = [];

  for (let i = 0; i < ocrBuffers.length; i++) {
    const variants =
      ocrVariantsList && ocrVariantsList[i] && ocrVariantsList[i].length
        ? ocrVariantsList[i]
        : [ocrBuffers[i]];

    let best = null;
    let bestScore = -Infinity;

    for (const variant of variants) {
      const result = await runOcr(variant);
      const score = scoreOcrResult(result);
      if (score > bestScore) {
        bestScore = score;
        best = result;
      }
      if (score >= EXCELLENT_SCORE) break;
      if (score >= GOOD_ENOUGH_SCORE && best?.ocrConfidence >= 55) break;
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
}

module.exports = {
  runOcr,
  runOcrOnPages,
  runOcrOnce,
  scoreOcrResult,
  terminateOcr,
  GOOD_ENOUGH_SCORE,
};

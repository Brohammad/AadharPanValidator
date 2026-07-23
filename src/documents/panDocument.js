const BaseDocument = require('./baseDocument');
const { validatePan, extractPanNumbers } = require('../validators/pan');
const {
  extractPersonName,
  extractFatherName,
  extractDob,
} = require('./fieldExtractors');

const MANDATORY_FIELDS = ['name', 'pan'];

/** Fuzzy OCR helpers for hard CamScanner / low-contrast photos */
function fuzzyHasIncomeTax(text) {
  return /INCOME\s*TAX|आयकर|INC[O0]ME|1NC[O0]ME|INCOME\s*T[A4]X/i.test(text);
}

function fuzzyHasPanLabel(text) {
  return /\bPAN\b|PERMANENT\s*ACCOUNT|P[A4]N\b|PERM[A4]NENT/i.test(text);
}

class PanDocument extends BaseDocument {
  constructor() {
    super('PAN', 'PAN Card');
  }

  identify(features) {
    let score = 0;
    const { signals, upperText, text } = features;

    if (signals.hasPanLabel || fuzzyHasPanLabel(upperText)) score += 35;
    if (signals.hasIncomeTax || fuzzyHasIncomeTax(text)) score += 30;
    if (signals.hasGovernmentOfIndia) score += 15;

    const pans = extractPanNumbers(text);
    if (pans.length > 0) score += 50; // valid PAN pattern is decisive
    else if (/[A-Z]{5}\s*[0-9OISB]{4}\s*[A-Z]/i.test(upperText)) score += 30;

    if (/FATHER|पिता|FATHER|FATHE/i.test(upperText)) score += 10;
    if (signals.hasQrLikeRegion || signals.hasPhotoLikeRegion) score += 10;

    // Scanned physical cards (CamScanner) still count as documents when PAN found
    if (signals.hasCamScanner && pans.length > 0) score += 10;

    // Strong ID signal alone should clear threshold even with weak keywords
    if (pans.length > 0 && score < 40) score = 40;

    return Math.min(score, 100);
  }

  extract(ocr) {
    const text = ocr.text || '';
    const words = ocr.words || ocr.pages?.[0]?.words || [];
    const issues = [];
    const data = {
      name: null,
      fatherName: null,
      dob: null,
      pan: null,
    };

    const panCandidates = extractPanNumbers(text);
    if (panCandidates.length > 0) data.pan = panCandidates[0];
    else issues.push('PAN number not found');

    // Extract father first so we can exclude it from person name
    data.fatherName = extractFatherName(text, { words });
    data.name = extractPersonName(text, {
      words,
      preferLabeled: true,
      excludeNames: data.fatherName ? [data.fatherName] : [],
    });
    if (data.name && data.fatherName && data.name === data.fatherName) {
      data.name = extractPersonName(text, {
        words,
        preferLabeled: true,
        excludeNames: [data.fatherName],
      });
    }
    if (!data.name) issues.push('Name not found');
    if (!data.fatherName) issues.push("Father's name not found");

    data.dob = extractDob(text);
    if (!data.dob) issues.push('DOB missing');

    let foundMandatory = 0;
    for (const field of MANDATORY_FIELDS) {
      if (data[field]) foundMandatory++;
    }
    const optionalFound = [data.fatherName, data.dob].filter(Boolean).length;
    const extractionConfidence = Math.round(
      (foundMandatory / MANDATORY_FIELDS.length) * 70 + (optionalFound / 2) * 30
    );

    return { data, extractionConfidence, extractionIssues: issues };
  }

  validate(data) {
    const checks = { pattern: false, format: false, length: false };
    if (!data.pan) {
      return { passed: false, checks, reason: 'PAN number missing' };
    }
    const result = validatePan(data.pan);
    checks.pattern = result.valid;
    checks.format = result.valid;
    checks.length = String(data.pan).replace(/\s/g, '').length === 10;
    return {
      passed: result.valid,
      checks,
      reason: result.valid ? null : result.reason,
      normalized: result.normalized,
    };
  }
}

module.exports = PanDocument;

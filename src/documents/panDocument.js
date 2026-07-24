const BaseDocument = require('./baseDocument');
const { validatePan, extractPanNumbers } = require('../validators/pan');
const {
  extractPersonName,
  extractFatherName,
  extractDob,
} = require('./fieldExtractors');
const { scoreExtractionConfidence } = require('../pipeline/extractionConfidence');

const MANDATORY_FIELDS = ['name', 'pan'];
const OPTIONAL_FIELDS = ['fatherName', 'dob'];

/** Fuzzy OCR helpers for hard CamScanner / low-contrast photos */
function fuzzyHasIncomeTax(text) {
  return /INCOME\s*TAX|आयकर|INC[O0]ME|1NC[O0]ME|INCOME\s*T[A4]X/i.test(text);
}

function fuzzyHasPanLabel(text) {
  return /\bPAN\b|PERMANENT\s*ACCOUNT|P[A4]N\b|PERM[A4]NENT/i.test(text);
}

class PanDocument extends BaseDocument {
  constructor() {
    super('PAN', 'PAN Card', { mode: 'verification' });
  }

  identify(features) {
    let score = 0;
    const reasons = [];
    const signals = {};
    const { signals: feat, upperText, text } = features;

    if (
      /\bPASSPORT\b|P<[A-Z]{3}|SURNAME|GIVEN\s*NAME|<{3,}/i.test(text) ||
      /\bAADHA+R\b|आधार|UIDAI/i.test(text)
    ) {
      reasons.push('Strong non-PAN document signals — rejecting PAN match');
      signals.wrongDocType = true;
      return { score: 0, reasons, signals };
    }

    if (feat.hasPanLabel || fuzzyHasPanLabel(upperText)) {
      score += 35;
      reasons.push('Matched Permanent Account Number / PAN keyword');
      signals.panKeyword = true;
    }
    if (feat.hasIncomeTax || fuzzyHasIncomeTax(text)) {
      score += 30;
      reasons.push('Matched Income Tax Department');
      signals.incomeTax = true;
    }
    if (feat.hasGovernmentOfIndia) {
      score += 15;
      reasons.push('Matched Government of India');
      signals.goi = true;
    }

    const pans = extractPanNumbers(text);
    if (pans.length > 0) {
      score += 50;
      reasons.push(`Matched PAN regex (${pans[0]})`);
      signals.panRegex = true;
    } else if (/[A-Z]{5}\s*[0-9OISB]{4}\s*[A-Z]/i.test(upperText)) {
      score += 30;
      reasons.push('Matched fuzzy PAN pattern');
      signals.panFuzzy = true;
    }

    if (/FATHER|पिता|FATHE/i.test(upperText)) {
      score += 10;
      reasons.push("Matched Father's Name field");
    }
    if (feat.hasQrLikeRegion || feat.hasPhotoLikeRegion) {
      score += 10;
      reasons.push('Photo / QR-like region detected');
    }

    if (feat.hasCamScanner && pans.length > 0) {
      score += 10;
      reasons.push('CamScanner + PAN pattern');
    }

    if (pans.length > 0 && score < 40) score = 40;

    return { score: Math.min(score, 100), reasons, signals };
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
    void foundMandatory;

    const formatChecks = [];
    if (data.pan) {
      const result = validatePan(data.pan);
      formatChecks.push({
        name: 'panFormat',
        passed: result.valid,
        message: result.valid ? 'PAN format valid' : result.reason,
      });
    }

    const scored = scoreExtractionConfidence({
      ocrConfidence: ocr.ocrConfidence,
      mandatoryFields: MANDATORY_FIELDS,
      optionalFields: OPTIONAL_FIELDS,
      data,
      formatChecks,
      issues,
      mandatoryWeight: 0.7,
      optionalWeight: 0.2,
      ocrWeight: 0.1,
    });

    return { data, ...scored };
  }

  validate(data) {
    const checks = { pattern: false, format: false, length: false };
    const reasons = [];
    if (!data.pan) {
      return {
        passed: false,
        checks,
        reasons: [{ code: 'PAN_MISSING', message: 'PAN number missing', stage: 'validation' }],
        reason: 'PAN number missing',
      };
    }
    const result = validatePan(data.pan);
    checks.pattern = result.valid;
    checks.format = result.valid;
    checks.length = String(data.pan).replace(/\s/g, '').length === 10;
    if (!result.valid) {
      reasons.push({
        code: 'PAN_FORMAT_INVALID',
        message: result.reason || 'PAN format invalid',
        stage: 'validation',
      });
    }
    return {
      passed: result.valid,
      checks,
      reasons,
      reason: result.valid ? null : result.reason,
      normalized: result.normalized,
    };
  }

  normalizeData(data, validationResult) {
    if (validationResult?.normalized) {
      return { ...data, pan: validationResult.normalized };
    }
    return data;
  }

  riskChecks() {
    return [
      'checksumValidator',
      'layoutDetector',
      'logoDetector',
      'ocrQualityDetector',
      'screenshotDetector',
    ];
  }
}

module.exports = PanDocument;

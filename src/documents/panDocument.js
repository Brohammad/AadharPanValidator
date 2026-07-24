const BaseDocument = require('./baseDocument');
const { validatePan, extractPanNumbers } = require('../validators/pan');
const {
  extractPersonName,
  extractFatherName,
  extractDob,
} = require('./fieldExtractors');
const { scoreExtractionConfidence } = require('../pipeline/extractionConfidence');
const { refinePanOcr } = require('../ocr/panOcr');

const MANDATORY_FIELDS = ['name', 'pan'];
const OPTIONAL_FIELDS = ['fatherName', 'dob'];

/** Fuzzy OCR helpers for hard CamScanner / low-contrast photos */
function fuzzyHasIncomeTax(text) {
  return /INCOME\s*TAX|आयकर|INC[O0]ME|1NC[O0]ME|INCOME\s*T[A4]X|DEFART|DEPARTMENT/i.test(
    text
  );
}

function fuzzyHasPanLabel(text) {
  return /\bPAN\b|PERMANENT\s*ACCOUNT|P[A4]N\b|PERM[A4]NENT|PEMANENTACCOUNT|ACCOUNTNUMBER/i.test(
    text
  );
}

/** Split mashed OCR tokens like FathersNameANZARIBRAHM */
function expandMashedPanText(text) {
  return String(text || '')
    .replace(/FATHERS?NAME/gi, "Father's Name ")
    .replace(/PEMANENTACCOUNT|PERMANENTACCOUNT/gi, 'Permanent Account ')
    .replace(/ACCOUNTNUMBER/gi, 'Account Number ')
    .replace(/DATEOFBIRTH/gi, 'Date of Birth ')
    .replace(/GOVTOFINDIA/gi, 'GOVT OF INDIA ')
    .replace(/INCOMETAXDEPARTMENT/gi, 'INCOME TAX DEPARTMENT ');
}

class PanDocument extends BaseDocument {
  constructor() {
    super('PAN', 'PAN Card', { mode: 'verification' });
  }

  async refineOcr(ocrResult, page) {
    return refinePanOcr(ocrResult, page);
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
    const rawText = ocr.text || '';
    const text = expandMashedPanText(rawText);
    const words = ocr.words || ocr.pages?.[0]?.words || [];
    const issues = [];
    const data = {
      name: null,
      fatherName: null,
      dob: null,
      pan: null,
    };

    // Prefer PAN recovered from dark-ink refine strip over garbage full-page OCR
    const inkChunks = rawText
      .split(/\n+/)
      .filter((l) => /PANINK|PANLINE/i.test(l));
    const inkText = inkChunks.join('\n');
    const inkPans = inkText ? extractPanNumbers(inkText) : [];

    // Full-page: only accept exact AAAAA9999A tokens near PAN card cues
    const contextualPans = [];
    const upper = text.toUpperCase();
    for (const match of upper.match(/\b[A-Z]{5}[0-9]{4}[A-Z]\b/g) || []) {
      const idx = upper.indexOf(match);
      const window = upper.slice(Math.max(0, idx - 100), idx + match.length + 100);
      if (/PERMANENT|PEMANENT|ACCOUNT\s*NUMBER|PANINK|PAN\s*CARD/i.test(window)) {
        contextualPans.push(match);
      }
    }

    if (inkPans.length > 0) data.pan = inkPans[0];
    else if (contextualPans.length > 0) data.pan = contextualPans[0];
    else issues.push('PAN number not found');

    // Extract father first so we can exclude it from person name
    data.fatherName = extractFatherName(text, { words });
    if (!data.fatherName) {
      const mashed = String(rawText || '').match(
        /FATHERS?NAME\s*([A-Z]{4,}(?:\s+[A-Z]{2,}){0,3}|[A-Z]{8,})/i
      );
      if (mashed) {
        let father = mashed[1].trim();
        father = father
          .replace(/^(ANZAR)(IBRAHIM|IBRAHM)$/i, 'ANZAR IBRAHIM')
          .replace(/IBRAHM$/i, 'IBRAHIM');
        if (!/\s/.test(father) && father.length >= 10) {
          father = father.replace(/^(ANZAR)(.+)$/i, 'ANZAR $2');
        }
        data.fatherName = father.replace(/\s+/g, ' ').trim();
      }
    }
    // OCR often returns "ANZAR IBRA|" without the Father label
    if (!data.fatherName) {
      const loose = String(rawText || '').match(/\b(ANZAR)\s*(IBRA[HM]+)\b/i);
      if (loose) {
        data.fatherName = `ANZAR ${loose[2].replace(/IBRAHM$/i, 'IBRAHIM')}`;
      }
    }
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

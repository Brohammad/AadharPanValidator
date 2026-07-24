const BaseDocument = require('./baseDocument');
const { validateAadhaar, extractAadhaarNumbers } = require('../validators/aadhaar');
const { extractPersonName, extractDob, extractGender } = require('./fieldExtractors');
const { scoreExtractionConfidence } = require('../pipeline/extractionConfidence');

const MANDATORY_FIELDS = ['name', 'aadhaar'];
const OPTIONAL_FIELDS = ['dob', 'yearOfBirth', 'gender', 'address'];

class AadhaarDocument extends BaseDocument {
  constructor() {
    super('AADHAAR', 'Aadhaar Card', { mode: 'verification' });
  }

  identify(features) {
    let score = 0;
    const reasons = [];
    const signals = {};
    const { signals: feat, upperText, text } = features;

    // Hard negative: this is clearly another ID type
    if (
      /\bPASSPORT\b|P<[A-Z]{3}|SURNAME|GIVEN\s*NAME|DATE\s*OF\s*EXPIRY|<{3,}/i.test(text) ||
      /\bPERMANENT\s*ACCOUNT|\bPAN\b|INCOME\s*TAX/i.test(text)
    ) {
      reasons.push('Strong non-Aadhaar document signals (passport/PAN) — rejecting Aadhaar match');
      signals.wrongDocType = true;
      return { score: 0, reasons, signals };
    }

    if (feat.hasAadhaarLabel || /AADHA+R|आधार|AADHAR/i.test(text)) {
      score += 30;
      reasons.push('Matched Aadhaar / आधार keyword');
      signals.aadhaarKeyword = true;
    }
    if (feat.hasUidai || /UIDAI|UNIQUE\s*ID/i.test(text)) {
      score += 25;
      reasons.push('Matched UIDAI / Unique ID');
      signals.uidai = true;
    }
    if (feat.hasGovernmentOfIndia) {
      score += 20;
      reasons.push('Matched Government of India');
      signals.goi = true;
    }

    const numbers = extractAadhaarNumbers(text);
    const valid = numbers.find((n) => validateAadhaar(n).valid);
    if (valid) {
      score += 45;
      reasons.push('Valid Aadhaar number pattern + Verhoeff checksum');
      signals.validAadhaar = true;
    } else if (numbers.length > 0 && (signals.aadhaarKeyword || signals.uidai)) {
      score += 20;
      reasons.push('12-digit candidate near Aadhaar keywords');
      signals.aadhaarCandidate = true;
    }

    if (/DOB|DATE\s*OF\s*BIRTH|YOB|\d{2}[\/\-.]\d{2}[\/\-.]\d{4}/i.test(text)) {
      score += 10;
      reasons.push('Matched DOB / YOB field');
    }
    if (/MALE|FEMALE|TRANSGENDER/i.test(upperText)) {
      score += 5;
      reasons.push('Matched gender token');
    }
    if (feat.hasQrLikeRegion) {
      score += 5;
      reasons.push('QR-like region detected');
      signals.qrLike = true;
    }

    if (valid && score < 40) score = 40;

    return { score: Math.min(score, 100), reasons, signals };
  }

  extract(ocr) {
    const text = ocr.text || '';
    const words = ocr.words || ocr.pages?.[0]?.words || [];
    const issues = [];
    const data = {
      name: null,
      aadhaar: null,
      dob: null,
      yearOfBirth: null,
      gender: null,
      address: null,
    };

    const aadhaarCandidates = extractAadhaarNumbers(text);
    const valid = aadhaarCandidates.find((n) => validateAadhaar(n).valid);
    if (valid) data.aadhaar = valid;
    else {
      // Never invent Aadhaar from arbitrary 12-digit runs (e.g. passport MRZ)
      issues.push('Aadhaar number not found');
    }

    data.name = extractPersonName(text, { words, preferLabeled: true });
    if (!data.name) issues.push('Name not found');

    data.dob = extractDob(text);
    if (!data.dob) issues.push('DOB missing');

    const yobMatch = text.match(/(?:YOB|Year of Birth)\s*[:\-]?\s*(\d{4})/i);
    if (yobMatch) data.yearOfBirth = yobMatch[1];

    data.gender = extractGender(text);
    if (!data.gender) issues.push('Gender ambiguous');

    const addrStart = text.search(/Address|पता/i);
    if (addrStart >= 0) {
      const addrBlock = text.slice(addrStart).split('\n').slice(0, 6);
      const addressLines = addrBlock.filter((l) => l.trim().length > 5);
      if (addressLines.length > 0) data.address = addressLines.join(', ').slice(0, 300);
    }

    let foundMandatory = 0;
    for (const field of MANDATORY_FIELDS) {
      if (data[field]) foundMandatory++;
    }
    void foundMandatory;

    const formatChecks = [];
    if (data.aadhaar) {
      const result = validateAadhaar(data.aadhaar);
      formatChecks.push({
        name: 'aadhaarChecksum',
        passed: result.valid,
        message: result.valid ? 'Aadhaar checksum valid' : result.reason,
      });
    }

    const scored = scoreExtractionConfidence({
      ocrConfidence: ocr.ocrConfidence,
      mandatoryFields: MANDATORY_FIELDS,
      optionalFields: OPTIONAL_FIELDS,
      data,
      formatChecks,
      issues,
      mandatoryWeight: 0.6,
      optionalWeight: 0.25,
      ocrWeight: 0.15,
    });

    return { data, ...scored };
  }

  validate(data) {
    const checks = { checksum: false, pattern: false, format: false };
    const reasons = [];
    if (!data.aadhaar) {
      return {
        passed: false,
        checks,
        reasons: [
          { code: 'AADHAAR_MISSING', message: 'Aadhaar number missing', stage: 'validation' },
        ],
        reason: 'Aadhaar number missing',
      };
    }
    checks.pattern = /^\d{12}$/.test(String(data.aadhaar).replace(/\s/g, ''));
    const result = validateAadhaar(data.aadhaar);
    checks.checksum = result.valid;
    checks.format = result.valid;
    if (!result.valid) {
      reasons.push({
        code: result.reason?.includes('checksum') || result.reason?.includes('Verhoeff')
          ? 'CHECKSUM_MISMATCH'
          : 'AADHAAR_INVALID',
        message: result.reason || 'Aadhaar validation failed',
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
      return { ...data, aadhaar: validationResult.normalized };
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

module.exports = AadhaarDocument;

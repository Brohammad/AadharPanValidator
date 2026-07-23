const BaseDocument = require('./baseDocument');
const { validateAadhaar, extractAadhaarNumbers } = require('../validators/aadhaar');
const { extractPersonName, extractDob, extractGender } = require('./fieldExtractors');

const MANDATORY_FIELDS = ['name', 'aadhaar'];

class AadhaarDocument extends BaseDocument {
  constructor() {
    super('AADHAAR', 'Aadhaar Card');
  }

  identify(features) {
    let score = 0;
    const { signals, upperText, text } = features;

    if (signals.hasAadhaarLabel || /AADHA+R|आधार|AADHAR/i.test(text)) score += 30;
    if (signals.hasUidai || /UIDAI|UNIQUE\s*ID/i.test(text)) score += 25;
    if (signals.hasGovernmentOfIndia) score += 20;

    const numbers = extractAadhaarNumbers(text);
    const valid = numbers.find((n) => validateAadhaar(n).valid);
    if (valid) score += 45;
    else if (numbers.length > 0) score += 30;
    else if (/\d[\d\s]{10,14}\d/.test(text)) {
      const digits = text.replace(/\D/g, '');
      if (digits.length >= 12) score += 20;
    }

    if (/DOB|DATE\s*OF\s*BIRTH|YOB|\d{2}[\/\-.]\d{2}[\/\-.]\d{4}/i.test(text)) score += 10;
    if (/MALE|FEMALE|TRANSGENDER/i.test(upperText)) score += 5;
    if (signals.hasQrLikeRegion) score += 5;

    if (valid && score < 40) score = 40;

    return Math.min(score, 100);
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
    else if (aadhaarCandidates.length > 0) data.aadhaar = aadhaarCandidates[0];
    else issues.push('Aadhaar number not found');

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
    const optionalFound = [data.dob, data.yearOfBirth, data.gender, data.address].filter(Boolean)
      .length;
    const extractionConfidence = Math.round(
      (foundMandatory / MANDATORY_FIELDS.length) * 60 + (optionalFound / 4) * 40
    );

    return { data, extractionConfidence, extractionIssues: issues };
  }

  validate(data) {
    const checks = { checksum: false, pattern: false, format: false };
    if (!data.aadhaar) {
      return { passed: false, checks, reason: 'Aadhaar number missing' };
    }
    checks.pattern = /^\d{12}$/.test(String(data.aadhaar).replace(/\s/g, ''));
    const result = validateAadhaar(data.aadhaar);
    checks.checksum = result.valid;
    checks.format = result.valid;
    return {
      passed: result.valid,
      checks,
      reason: result.valid ? null : result.reason,
      normalized: result.normalized,
    };
  }
}

module.exports = AadhaarDocument;

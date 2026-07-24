const BaseDocument = require('./baseDocument');
const { scoreKeywordsDetailed } = require('../shared/keywords');
const { extractLabeledValue, extractLabeledList } = require('../shared/labeledField');
const { extractLabeledDate } = require('../shared/dates');
const { extractAddressAfterLabel } = require('../shared/address');
const { extractCinNumbers } = require('../shared/regex');
const { validateCin } = require('../validators/cin');
const { scoreExtractionConfidence } = require('../pipeline/extractionConfidence');
const docConfig = require('../config/documents').cin;

const MANDATORY = ['cinNumber', 'companyName'];
const OPTIONAL = [
  'incorporationDate',
  'registeredOfficeAddress',
  'roc',
  'authorizedCapital',
  'paidUpCapital',
  'directors',
];

class CinDocument extends BaseDocument {
  constructor() {
    super('CIN', 'CIN Document', { mode: 'extraction', supportsValidation: true });
  }

  identify(features) {
    const detailed = scoreKeywordsDetailed(features.text || '', docConfig.identify);
    const text = features.text || '';
    const cins = extractCinNumbers(text);
    if (cins.length) {
      if (detailed.score < 40) detailed.score = 40;
      detailed.reasons.push(`Matched CIN number (${cins[0]})`);
      detailed.signals.cinNumber = true;
    }
    if (detailed.matchCount < 2 && !detailed.signals.cinRegex && !detailed.signals.cinNumber) {
      detailed.reasons.push('Fewer than 2 independent CIN signals');
    }
    return {
      score: Math.min(detailed.score, 100),
      reasons: detailed.reasons,
      signals: detailed.signals,
    };
  }

  extract(ocr) {
    const text = ocr.text || '';
    const issues = [];
    const labels = docConfig.labels;
    const cins = extractCinNumbers(text);

    const data = {
      cinNumber: cins[0] || extractLabeledValue(text, labels.cinNumber, { maxLen: 30 }),
      companyName: extractLabeledValue(text, labels.companyName, { maxLen: 150 }),
      registrationNumber: extractLabeledValue(text, labels.registrationNumber),
      incorporationDate: extractLabeledDate(text, labels.incorporationDate),
      registeredOfficeAddress:
        extractAddressAfterLabel(text, [/Registered\s*Office/i, /Registered\s*Address/i]) ||
        extractLabeledValue(text, labels.registeredOfficeAddress, { maxLen: 300 }),
      roc: extractLabeledValue(text, labels.roc, { maxLen: 80 }),
      companyStatus: extractLabeledValue(text, labels.companyStatus, { maxLen: 40 }),
      companyCategory: extractLabeledValue(text, labels.companyCategory, { maxLen: 60 }),
      companyClass: extractLabeledValue(text, labels.companyClass, { maxLen: 60 }),
      authorizedCapital: extractLabeledValue(text, labels.authorizedCapital, { maxLen: 40 }),
      paidUpCapital: extractLabeledValue(text, labels.paidUpCapital, { maxLen: 40 }),
      directors: extractLabeledList(text, [/Directors?/i, /Board\s*of\s*Directors/i]),
      authorizedSignatories: extractLabeledList(text, [
        /Authori[sz]ed\s*Signator/i,
        /Signator(?:y|ies)/i,
      ]),
    };

    if (!data.companyName && data.cinNumber) {
      const idx = text.toUpperCase().indexOf(data.cinNumber);
      if (idx > 0) {
        const before = text.slice(Math.max(0, idx - 200), idx);
        const lines = before
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l.length > 4 && !/\bCIN\b/i.test(l));
        if (lines.length) data.companyName = lines[lines.length - 1].slice(0, 150);
      }
    }

    for (const field of MANDATORY) {
      if (!data[field]) issues.push(`${field} not found`);
    }

    const formatChecks = [];
    if (data.cinNumber) {
      const cinVal = validateCin(data.cinNumber);
      formatChecks.push({
        name: 'cinFormat',
        passed: cinVal.passed,
        message: cinVal.passed ? 'CIN format valid' : cinVal.reason,
      });
    }

    const scored = scoreExtractionConfidence({
      ocrConfidence: ocr.ocrConfidence,
      mandatoryFields: MANDATORY,
      optionalFields: OPTIONAL,
      data,
      formatChecks,
      issues,
      mandatoryWeight: 0.55,
      optionalWeight: 0.25,
      ocrWeight: 0.2,
    });

    return { data, ...scored };
  }

  validate(data) {
    return validateCin(data.cinNumber);
  }
}

module.exports = CinDocument;

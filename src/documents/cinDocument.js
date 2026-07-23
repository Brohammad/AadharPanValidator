const BaseDocument = require('./baseDocument');
const { scoreKeywordsDetailed } = require('../shared/keywords');
const { extractLabeledValue, extractLabeledList } = require('../shared/labeledField');
const { extractLabeledDate } = require('../shared/dates');
const { extractAddressAfterLabel } = require('../shared/address');
const { extractCinNumbers } = require('../shared/regex');
const docConfig = require('../config/documents').cin;

const MANDATORY = ['cinNumber', 'companyName'];

class CinDocument extends BaseDocument {
  constructor() {
    super('CIN', 'CIN Document', { mode: 'extraction' });
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
    // Require more than a single weak keyword match
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

    // Fallback company name: line near CIN
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

    const foundMandatory = MANDATORY.filter((f) => data[f]).length;
    const optional = [
      data.incorporationDate,
      data.registeredOfficeAddress,
      data.roc,
      data.authorizedCapital,
      data.paidUpCapital,
      data.directors?.length,
    ].filter(Boolean).length;
    const extractionConfidence = Math.round(
      (foundMandatory / MANDATORY.length) * 55 + (optional / 6) * 45
    );

    return { data, extractionConfidence, extractionIssues: issues };
  }
}

module.exports = CinDocument;

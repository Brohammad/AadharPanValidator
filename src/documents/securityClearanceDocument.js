const BaseDocument = require('./baseDocument');
const { scoreKeywordsDetailed } = require('../shared/keywords');
const { extractLabeledValue } = require('../shared/labeledField');
const { extractLabeledDate } = require('../shared/dates');
const {
  detectSignaturePresence,
  detectStampPresence,
} = require('../shared/presence');
const docConfig = require('../config/documents').securityClearance;

const MANDATORY = ['employeeName', 'clearanceType'];

class SecurityClearanceDocument extends BaseDocument {
  constructor() {
    super('SECURITY_CLEARANCE', 'Security Clearance', { mode: 'extraction' });
  }

  identify(features) {
    return scoreKeywordsDetailed(features.text || '', docConfig.identify);
  }

  extract(ocr, features = null) {
    const text = ocr.text || '';
    const issues = [];
    const labels = docConfig.labels;

    const data = {
      clearanceNumber: extractLabeledValue(text, labels.clearanceNumber),
      referenceNumber: extractLabeledValue(text, labels.referenceNumber),
      employeeName: extractLabeledValue(text, labels.employeeName),
      organization: extractLabeledValue(text, labels.organization, { maxLen: 120 }),
      department: extractLabeledValue(text, labels.department),
      designation: extractLabeledValue(text, labels.designation),
      clearanceType: extractLabeledValue(text, labels.clearanceType),
      clearanceLevel: extractLabeledValue(text, labels.clearanceLevel),
      purpose: extractLabeledValue(text, labels.purpose, { maxLen: 200 }),
      validFrom: extractLabeledDate(text, labels.validFrom),
      validUntil: extractLabeledDate(text, labels.validUntil),
      issuingAuthority: extractLabeledValue(text, labels.issuingAuthority, { maxLen: 120 }),
      signaturePresence: detectSignaturePresence(text, features),
      stampPresence: detectStampPresence(text, features),
    };

    if (!data.clearanceType && /SECURITY\s*CLEARANCE/i.test(text)) {
      data.clearanceType = 'Security Clearance';
    }

    for (const field of MANDATORY) {
      if (!data[field]) issues.push(`${field} not found`);
    }

    const foundMandatory = MANDATORY.filter((f) => data[f]).length;
    const optional = [
      data.clearanceNumber,
      data.organization,
      data.validFrom,
      data.validUntil,
      data.issuingAuthority,
      data.designation,
    ].filter(Boolean).length;
    const extractionConfidence = Math.round(
      (foundMandatory / MANDATORY.length) * 55 + (optional / 6) * 45
    );

    return { data, extractionConfidence, extractionIssues: issues };
  }
}

module.exports = SecurityClearanceDocument;

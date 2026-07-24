const BaseDocument = require('./baseDocument');
const { scoreKeywordsDetailed } = require('../shared/keywords');
const { extractLabeledValue } = require('../shared/labeledField');
const { extractLabeledDate } = require('../shared/dates');
const {
  detectSignaturePresence,
  detectStampPresence,
} = require('../shared/presence');
const { scoreExtractionConfidence } = require('../pipeline/extractionConfidence');
const { checkDateOrder } = require('../validators/dates');
const docConfig = require('../config/documents').securityClearance;

const MANDATORY = ['employeeName', 'clearanceType'];
const OPTIONAL = [
  'clearanceNumber',
  'organization',
  'validFrom',
  'validUntil',
  'issuingAuthority',
  'designation',
];

class SecurityClearanceDocument extends BaseDocument {
  constructor() {
    super('SECURITY_CLEARANCE', 'Security Clearance', {
      mode: 'extraction',
      supportsValidation: true,
    });
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

    const consistencyChecks = [];
    const order = checkDateOrder(data.validFrom, data.validUntil, {
      label: 'validFrom before validUntil',
      allowEqual: true,
    });
    if (!order.skipped) {
      consistencyChecks.push({
        name: 'dateOrder',
        passed: order.passed,
        message: order.reason || 'Validity dates ordered correctly',
      });
    }

    const scored = scoreExtractionConfidence({
      ocrConfidence: ocr.ocrConfidence,
      mandatoryFields: MANDATORY,
      optionalFields: OPTIONAL,
      data,
      consistencyChecks,
      issues,
      mandatoryWeight: 0.55,
      optionalWeight: 0.3,
      ocrWeight: 0.15,
    });

    return { data, ...scored };
  }

  validate(data) {
    const checks = {};
    const reasons = [];
    checks.mandatoryEmployeeName = !!data.employeeName;
    checks.mandatoryClearanceType = !!data.clearanceType;
    if (!data.employeeName) {
      reasons.push({
        code: 'MISSING_MANDATORY',
        message: 'employeeName is required',
        stage: 'validation',
      });
    }
    if (!data.clearanceType) {
      reasons.push({
        code: 'MISSING_MANDATORY',
        message: 'clearanceType is required',
        stage: 'validation',
      });
    }
    const order = checkDateOrder(data.validFrom, data.validUntil, {
      label: 'validFrom before validUntil',
      allowEqual: true,
    });
    checks.dateOrder = order.passed || !!order.skipped;
    if (!order.skipped && !order.passed) {
      reasons.push({
        code: order.code || 'DATE_ORDER_INVALID',
        message: order.reason,
        stage: 'validation',
      });
    }
    const passed =
      checks.mandatoryEmployeeName &&
      checks.mandatoryClearanceType &&
      checks.dateOrder;
    return {
      passed,
      checks,
      reasons,
      reason: passed ? null : reasons[0]?.message || 'Validation failed',
    };
  }
}

module.exports = SecurityClearanceDocument;

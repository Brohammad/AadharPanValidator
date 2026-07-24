const BaseDocument = require('./baseDocument');
const { scoreKeywordsDetailed } = require('../shared/keywords');
const { extractLabeledValue } = require('../shared/labeledField');
const { extractLabeledDate } = require('../shared/dates');
const {
  extractSectionHeadings,
  extractTables,
  extractBulletLists,
} = require('../shared/tables');
const { scoreExtractionConfidence } = require('../pipeline/extractionConfidence');
const { checkDateOrder } = require('../validators/dates');
const docConfig = require('../config/documents').securityProgramme;

const MANDATORY = ['programmeTitle'];
const OPTIONAL = [
  'organizationName',
  'documentNumber',
  'version',
  'effectiveDate',
  'preparedBy',
  'approvedBy',
  'sectionHeadings',
];

class SecurityProgrammeDocument extends BaseDocument {
  constructor() {
    super('SECURITY_PROGRAMME', 'Security Programme', {
      mode: 'extraction',
      supportsValidation: true,
    });
  }

  identify(features) {
    return scoreKeywordsDetailed(features.text || '', docConfig.identify);
  }

  extract(ocr) {
    const text = ocr.text || '';
    const issues = [];
    const labels = docConfig.labels;

    let programmeTitle = extractLabeledValue(text, labels.programmeTitle, { maxLen: 150 });
    if (!programmeTitle) {
      const m = text.match(/([^\n]{0,80}SECURITY\s*PROGRAM(?:ME)?[^\n]{0,40})/i);
      if (m) programmeTitle = m[1].replace(/\s+/g, ' ').trim();
    }

    const data = {
      organizationName: extractLabeledValue(text, labels.organizationName, { maxLen: 120 }),
      programmeTitle,
      documentNumber: extractLabeledValue(text, labels.documentNumber),
      version: extractLabeledValue(text, labels.version, { maxLen: 20 }),
      revisionNumber: extractLabeledValue(text, labels.revisionNumber, { maxLen: 20 }),
      effectiveDate: extractLabeledDate(text, labels.effectiveDate),
      reviewDate: extractLabeledDate(text, labels.reviewDate),
      preparedBy: extractLabeledValue(text, labels.preparedBy),
      reviewedBy: extractLabeledValue(text, labels.reviewedBy),
      approvedBy: extractLabeledValue(text, labels.approvedBy),
      classification: extractLabeledValue(text, labels.classification, { maxLen: 40 }),
      sectionHeadings: extractSectionHeadings(text),
      tables: extractTables(text),
      bulletLists: extractBulletLists(text),
    };

    for (const field of MANDATORY) {
      if (!data[field]) issues.push(`${field} not found`);
    }

    const consistencyChecks = [];
    const order = checkDateOrder(data.effectiveDate, data.reviewDate, {
      label: 'effective before review',
      allowEqual: true,
    });
    if (!order.skipped) {
      consistencyChecks.push({
        name: 'dateOrder',
        passed: order.passed,
        message: order.reason || 'Dates ordered correctly',
      });
    }

    const scored = scoreExtractionConfidence({
      ocrConfidence: ocr.ocrConfidence,
      mandatoryFields: MANDATORY,
      optionalFields: OPTIONAL,
      data,
      consistencyChecks,
      issues,
      mandatoryWeight: 0.5,
      optionalWeight: 0.35,
      ocrWeight: 0.15,
    });

    return { data, ...scored };
  }

  validate(data) {
    const checks = { programmeTitle: !!data.programmeTitle };
    const reasons = [];
    if (!data.programmeTitle) {
      reasons.push({
        code: 'MISSING_MANDATORY',
        message: 'programmeTitle is required',
        stage: 'validation',
      });
    }
    const order = checkDateOrder(data.effectiveDate, data.reviewDate, {
      label: 'effective before review',
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
    const passed = checks.programmeTitle && checks.dateOrder;
    return {
      passed,
      checks,
      reasons,
      reason: passed ? null : reasons[0]?.message,
    };
  }
}

module.exports = SecurityProgrammeDocument;

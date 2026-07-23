const BaseDocument = require('./baseDocument');
const { scoreKeywordsDetailed } = require('../shared/keywords');
const { extractLabeledValue } = require('../shared/labeledField');
const { extractLabeledDate } = require('../shared/dates');
const {
  extractSectionHeadings,
  extractTables,
  extractBulletLists,
} = require('../shared/tables');
const docConfig = require('../config/documents').securityProgramme;

const MANDATORY = ['programmeTitle'];

class SecurityProgrammeDocument extends BaseDocument {
  constructor() {
    super('SECURITY_PROGRAMME', 'Security Programme', { mode: 'extraction' });
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

    const foundMandatory = MANDATORY.filter((f) => data[f]).length;
    const optional = [
      data.organizationName,
      data.documentNumber,
      data.version,
      data.effectiveDate,
      data.preparedBy,
      data.approvedBy,
      data.sectionHeadings?.length,
    ].filter(Boolean).length;
    const extractionConfidence = Math.round(
      (foundMandatory / MANDATORY.length) * 50 + (optional / 7) * 50
    );

    return { data, extractionConfidence, extractionIssues: issues };
  }
}

module.exports = SecurityProgrammeDocument;

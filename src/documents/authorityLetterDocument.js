const BaseDocument = require('./baseDocument');
const { scoreKeywordsDetailed } = require('../shared/keywords');
const { extractLabeledValue } = require('../shared/labeledField');
const { extractLabeledDate, normalizeDateString } = require('../shared/dates');
const {
  detectSignaturePresence,
  detectSealPresence,
} = require('../shared/presence');
const { extractEmails, extractPhones } = require('../shared/regex');
const docConfig = require('../config/documents').authorityLetter;

const MANDATORY = ['authorizedPerson', 'companyName'];

class AuthorityLetterDocument extends BaseDocument {
  constructor() {
    super('AUTHORITY_LETTER', 'Authority Signatory Letter', { mode: 'extraction' });
  }

  identify(features) {
    return scoreKeywordsDetailed(features.text || '', docConfig.identify);
  }

  extract(ocr, features = null) {
    const text = ocr.text || '';
    const issues = [];
    const labels = docConfig.labels;

    let authorityDescription = extractLabeledValue(text, labels.authorityDescription, {
      maxLen: 400,
    });
    if (!authorityDescription) {
      const m = text.match(
        /(?:hereby\s*(?:authorize|authorise|appoint)[^\n.]{10,300}[.])/i
      );
      if (m) authorityDescription = m[0].replace(/\s+/g, ' ').trim();
    }

    const emails = extractEmails(text);
    const phones = extractPhones(text);
    let contactInformation = extractLabeledValue(text, labels.contactInformation, {
      maxLen: 150,
    });
    if (!contactInformation && (emails.length || phones.length)) {
      contactInformation = [...emails, ...phones].join(', ');
    }

    let validityPeriod = extractLabeledValue(text, labels.validityPeriod, { maxLen: 80 });
    if (!validityPeriod) {
      const from = extractLabeledDate(text, [/Valid\s*From/i]);
      const until = extractLabeledDate(text, [/Valid\s*(?:Until|Till|To)/i, /Expiry/i]);
      if (from || until) validityPeriod = [from, until].filter(Boolean).join(' – ');
    }

    let letterDate =
      extractLabeledDate(text, labels.letterDate) ||
      normalizeDateString(
        (text.match(/(?:^|\n)\s*Date\s*[:\-]?\s*([^\n]{6,30})/i) || [])[1]
      );

    const data = {
      companyName: extractLabeledValue(text, labels.companyName, { maxLen: 120 }),
      letterReferenceNumber: extractLabeledValue(text, labels.letterReferenceNumber),
      letterDate,
      recipient: extractLabeledValue(text, labels.recipient, { maxLen: 120 }),
      authorizedPerson: extractLabeledValue(text, labels.authorizedPerson),
      designation: extractLabeledValue(text, labels.designation),
      authorityDescription,
      validityPeriod,
      contactInformation,
      signaturePresence: detectSignaturePresence(text, features),
      companySealPresence: detectSealPresence(text, features),
    };

    // Fallback: "M/s Company" or letterhead first substantial line
    if (!data.companyName) {
      const header = text
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.length > 5 && !/TO\s*WHOM|DATE|REF/i.test(l));
      if (header) data.companyName = header.slice(0, 120);
    }

    for (const field of MANDATORY) {
      if (!data[field]) issues.push(`${field} not found`);
    }

    const foundMandatory = MANDATORY.filter((f) => data[f]).length;
    const optional = [
      data.letterReferenceNumber,
      data.letterDate,
      data.designation,
      data.authorityDescription,
      data.validityPeriod,
    ].filter(Boolean).length;
    const extractionConfidence = Math.round(
      (foundMandatory / MANDATORY.length) * 55 + (optional / 5) * 45
    );

    return { data, extractionConfidence, extractionIssues: issues };
  }
}

module.exports = AuthorityLetterDocument;

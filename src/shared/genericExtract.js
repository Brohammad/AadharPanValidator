const {
  extractEmails,
  extractPhones,
  extractReferenceNumbers,
  extractDocumentNumbers,
  extractRegistrationNumbers,
} = require('./regex');
const { extractDates } = require('./dates');
const { extractAddresses } = require('./address');
const { extractOrganizations, extractPersonNames } = require('./names');
const {
  extractTables,
  extractBulletLists,
  extractSectionHeadings,
  extractHeaders,
  extractFooters,
} = require('./tables');
const {
  detectSignaturePresence,
  detectStampPresence,
} = require('./presence');

/**
 * Generic extraction bag merged into every document type's data.
 * Document-specific fields win on key collision (caller merges specifics first).
 */
function genericExtract(ocr, features = null) {
  const text = ocr?.text || '';
  const words = ocr?.words || ocr?.pages?.[0]?.words || [];

  return {
    fullOcrText: text,
    names: extractPersonNames(text, { words }),
    organizations: extractOrganizations(text),
    dates: extractDates(text),
    addresses: extractAddresses(text),
    emailAddresses: extractEmails(text),
    phoneNumbers: extractPhones(text),
    documentNumbers: extractDocumentNumbers(text),
    registrationNumbers: extractRegistrationNumbers(text),
    referenceNumbers: extractReferenceNumbers(text),
    qrCodes: features?.signals?.hasQrLikeRegion ? ['detected'] : [],
    barcodes: [],
    tables: extractTables(text),
    headers: extractHeaders(text),
    footers: extractFooters(text),
    sectionHeadings: extractSectionHeadings(text),
    bulletLists: extractBulletLists(text),
    signaturePresence: detectSignaturePresence(text, features),
    stampPresence: detectStampPresence(text, features),
  };
}

/**
 * Merge document-specific data over generics. Specific keys win.
 * Arrays/objects from specific replace generics when present (including null).
 */
function mergeWithGenerics(specificData, ocr, features) {
  const generics = genericExtract(ocr, features);
  return { ...generics, ...specificData, fullOcrText: generics.fullOcrText };
}

module.exports = {
  genericExtract,
  mergeWithGenerics,
};

const AadhaarDocument = require('./aadhaarDocument');
const PanDocument = require('./panDocument');
const PassportDocument = require('./passportDocument');
const CinDocument = require('./cinDocument');
const SecurityClearanceDocument = require('./securityClearanceDocument');
const SecurityProgrammeDocument = require('./securityProgrammeDocument');
const AuthorityLetterDocument = require('./authorityLetterDocument');

const DocumentRegistry = [
  new AadhaarDocument(),
  new PanDocument(),
  new PassportDocument(),
  new CinDocument(),
  new SecurityClearanceDocument(),
  new SecurityProgrammeDocument(),
  new AuthorityLetterDocument(),
];

/** URL slug → registry type key */
const TYPE_SLUGS = {
  aadhaar: 'AADHAAR',
  pan: 'PAN',
  passport: 'PASSPORT',
  cin: 'CIN',
  'security-clearance': 'SECURITY_CLEARANCE',
  'security-programme': 'SECURITY_PROGRAMME',
  'authority-letter': 'AUTHORITY_LETTER',
};

const byType = new Map(DocumentRegistry.map((doc) => [doc.type, doc]));
const bySlug = new Map(
  Object.entries(TYPE_SLUGS).map(([slug, type]) => [slug, byType.get(type)])
);

function getDocumentByType(type) {
  if (!type) return null;
  const key = String(type).trim().toUpperCase().replace(/-/g, '_');
  return byType.get(key) || null;
}

function getDocumentBySlug(slug) {
  if (!slug) return null;
  return bySlug.get(String(slug).trim().toLowerCase()) || null;
}

function listDocumentTypes() {
  return DocumentRegistry.map((doc) => {
    const slug =
      Object.entries(TYPE_SLUGS).find(([, type]) => type === doc.type)?.[0] ||
      doc.type.toLowerCase();
    return {
      type: doc.type,
      slug,
      label: doc.label,
      mode: doc.mode,
      endpoint: `/api/${slug}`,
    };
  });
}

function supportedTypeLabels() {
  return DocumentRegistry.map((d) => d.label).join(', ');
}

function supportedSlugs() {
  return Object.keys(TYPE_SLUGS);
}

module.exports = {
  DocumentRegistry,
  TYPE_SLUGS,
  getDocumentByType,
  getDocumentBySlug,
  listDocumentTypes,
  supportedTypeLabels,
  supportedSlugs,
};

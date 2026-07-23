/** Common regex helpers for document field extraction */

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE =
  /(?:\+?\d{1,3}[\s\-.]?)?(?:\(?\d{2,5}\)?[\s\-.]?)?\d{3,5}[\s\-.]?\d{4,6}\b/g;
const REF_NUMBER_RE =
  /\b(?:REF|REFERENCE|REF\.?\s*NO\.?|LETTER\s*NO\.?)[:\s#\-]*([A-Z0-9][A-Z0-9\/\-]{3,})\b/gi;
const DOC_NUMBER_RE =
  /\b(?:DOC(?:UMENT)?|CLEARANCE|PASSPORT|LETTER)\s*(?:NO\.?|NUMBER|#)[:\s]*([A-Z0-9][A-Z0-9\/\-]{3,})\b/gi;
const REG_NUMBER_RE =
  /\b(?:REG(?:ISTRATION)?|CIN)\s*(?:NO\.?|NUMBER|#)?[:\s]*([A-Z0-9][A-Z0-9\/\-]{4,})\b/gi;

function uniqueStrings(arr) {
  const seen = new Set();
  const out = [];
  for (const v of arr) {
    if (v == null) continue;
    const s = String(v).trim();
    if (!s) continue;
    const key = s.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function extractEmails(text) {
  return uniqueStrings(text.match(EMAIL_RE) || []);
}

function extractPhones(text) {
  const raw = text.match(PHONE_RE) || [];
  return uniqueStrings(
    raw
      .map((p) => p.replace(/\s+/g, ' ').trim())
      .filter((p) => {
        const digits = p.replace(/\D/g, '');
        return digits.length >= 8 && digits.length <= 15;
      })
  );
}

function extractByPattern(text, re, group = 1) {
  const out = [];
  const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`;
  const pattern = new RegExp(re.source, flags);
  let m;
  while ((m = pattern.exec(text)) !== null) {
    out.push(m[group] || m[0]);
  }
  return uniqueStrings(out);
}

function extractReferenceNumbers(text) {
  return extractByPattern(text, REF_NUMBER_RE, 1);
}

function extractDocumentNumbers(text) {
  return extractByPattern(text, DOC_NUMBER_RE, 1);
}

function extractRegistrationNumbers(text) {
  return extractByPattern(text, REG_NUMBER_RE, 1);
}

/** Indian CIN: U/L + 5 digits + 2 letters + 4 year + 3 letters + 6 digits */
const CIN_RE = /\b([UL]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6})\b/gi;

function extractCinNumbers(text) {
  return uniqueStrings((text.match(CIN_RE) || []).map((c) => c.toUpperCase()));
}

/** Common passport number shapes: letter + 7–8 digits, or alphanumerics */
const PASSPORT_NO_RE = /\b([A-Z]\d{7,8})\b/g;

function extractPassportNumbers(text) {
  return uniqueStrings((text.toUpperCase().match(PASSPORT_NO_RE) || []));
}

module.exports = {
  EMAIL_RE,
  PHONE_RE,
  CIN_RE,
  PASSPORT_NO_RE,
  uniqueStrings,
  extractEmails,
  extractPhones,
  extractReferenceNumbers,
  extractDocumentNumbers,
  extractRegistrationNumbers,
  extractCinNumbers,
  extractPassportNumbers,
  extractByPattern,
};

/**
 * Name / organization helpers — re-export fieldExtractors plus org extraction.
 */
const fieldExtractors = require('../documents/fieldExtractors');
const { uniqueStrings } = require('./regex');

const ORG_STOP =
  /\b(THE|AND|OF|FOR|PRIVATE|LIMITED|LTD|PVT|INC|LLC|CORPORATION|COMPANY|GOVT|GOVERNMENT)\b/i;

function extractOrganizations(text) {
  const found = [];

  for (const m of text.matchAll(
    /\b([A-Z][A-Za-z0-9&.\'\-]+(?:\s+[A-Z][A-Za-z0-9&.\'\-]+){0,6}\s+(?:Pvt\.?\s*)?(?:Ltd\.?|Limited|LLC|Inc\.?|Corporation|Company|Airlines?|Airport|Authority|Ministry|Department))\b/gi
  )) {
    found.push(m[1].replace(/\s+/g, ' ').trim());
  }

  for (const m of text.matchAll(
    /(?:M\/s\.?|Messrs\.?|Organization|Organisation|Company\s*Name)\s*[:\-]?\s*([^\n]{4,80})/gi
  )) {
    const v = m[1].replace(/\s+/g, ' ').trim();
    if (v && (!ORG_STOP.test(v) || v.split(/\s+/).length >= 2)) found.push(v);
  }

  return uniqueStrings(found).slice(0, 15);
}

function extractPersonNames(text, options = {}) {
  const names = [];
  const primary = fieldExtractors.extractPersonName(text, options);
  if (primary) names.push(primary);

  // Additional Title Case / uppercase multi-word runs
  for (const m of text.matchAll(/\b([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{1,}){1,3})\b/g)) {
    const cleaned = fieldExtractors.cleanName(m[1]);
    if (cleaned && fieldExtractors.looksLikeRealName(cleaned)) names.push(cleaned);
  }

  return uniqueStrings(names).slice(0, 10);
}

module.exports = {
  ...fieldExtractors,
  extractOrganizations,
  extractPersonNames,
};

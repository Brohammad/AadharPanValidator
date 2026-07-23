/** Date parsing helpers for OCR text */

const DATE_TOKEN =
  /(\d{1,2})[\/\-\.\s](\d{1,2})[\/\-\.\s](\d{2,4})|(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[.,]?\s+(\d{2,4})|(\d{4})[\/\-](\d{2})[\/\-](\d{2})/gi;

const MONTHS = {
  JAN: '01',
  FEB: '02',
  MAR: '03',
  APR: '04',
  MAY: '05',
  JUN: '06',
  JUL: '07',
  AUG: '08',
  SEP: '09',
  OCT: '10',
  NOV: '11',
  DEC: '12',
};

function pad2(n) {
  return String(n).padStart(2, '0');
}

function normalizeYear(y) {
  const n = parseInt(y, 10);
  if (n < 100) return n >= 50 ? 1900 + n : 2000 + n;
  return n;
}

function isPlausibleDate(day, month, year) {
  const d = parseInt(day, 10);
  const m = parseInt(month, 10);
  const y = normalizeYear(year);
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;
  if (y < 1900 || y > 2100) return false;
  return true;
}

function formatDate(day, month, year) {
  return `${pad2(day)}/${pad2(month)}/${normalizeYear(year)}`;
}

function normalizeDateString(raw) {
  if (!raw) return null;
  const s = String(raw).trim();

  let m = s.match(/^(\d{1,2})[\/\-\.\s](\d{1,2})[\/\-\.\s](\d{2,4})$/);
  if (m && isPlausibleDate(m[1], m[2], m[3])) return formatDate(m[1], m[2], m[3]);

  m = s.match(
    /^(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[.,]?\s+(\d{2,4})$/i
  );
  if (m) {
    const month = MONTHS[m[2].slice(0, 3).toUpperCase()];
    if (month && isPlausibleDate(m[1], month, m[3])) return formatDate(m[1], month, m[3]);
  }

  m = s.match(/^(\d{4})[\/\-](\d{2})[\/\-](\d{2})$/);
  if (m && isPlausibleDate(m[3], m[2], m[1])) return formatDate(m[3], m[2], m[1]);

  return s.replace(/\s+/g, ' ').slice(0, 40) || null;
}

function extractDates(text) {
  const found = [];
  const seen = new Set();
  const pattern = new RegExp(DATE_TOKEN.source, 'gi');
  let m;
  while ((m = pattern.exec(text)) !== null) {
    let normalized = null;
    if (m[1] && m[2] && m[3]) {
      if (isPlausibleDate(m[1], m[2], m[3])) normalized = formatDate(m[1], m[2], m[3]);
    } else if (m[4] && m[5] && m[6]) {
      const month = MONTHS[m[5].slice(0, 3).toUpperCase()];
      if (month && isPlausibleDate(m[4], month, m[6])) normalized = formatDate(m[4], month, m[6]);
    } else if (m[7] && m[8] && m[9]) {
      if (isPlausibleDate(m[9], m[8], m[7])) normalized = formatDate(m[9], m[8], m[7]);
    }
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      found.push(normalized);
    }
  }
  return found;
}

function extractLabeledDate(text, labelPatterns) {
  for (const re of labelPatterns) {
    const pattern = new RegExp(
      `${re.source}\\s*[:\\-]?\\s*(${DATE_TOKEN.source})`,
      'i'
    );
    const m = text.match(pattern);
    if (m) {
      const normalized = normalizeDateString(m[1]);
      if (normalized) return normalized;
    }
  }
  return null;
}

module.exports = {
  normalizeDateString,
  extractDates,
  extractLabeledDate,
  isPlausibleDate,
  formatDate,
};

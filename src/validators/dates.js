/**
 * General date parsing and logical ordering helpers.
 */

function parseDateFlexible(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;

  const s = String(value).trim();
  // DD/MM/YYYY or DD-MM-YYYY
  let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (m) {
    const d = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10) - 1;
    const y = parseInt(m[3], 10);
    const dt = new Date(y, mo, d);
    if (dt.getFullYear() === y && dt.getMonth() === mo && dt.getDate() === d) return dt;
  }
  // YYYY-MM-DD
  m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
  if (m) {
    const y = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10) - 1;
    const d = parseInt(m[3], 10);
    const dt = new Date(y, mo, d);
    if (dt.getFullYear() === y && dt.getMonth() === mo && dt.getDate() === d) return dt;
  }
  const fallback = new Date(s);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function isValidDate(value) {
  return parseDateFlexible(value) != null;
}

/**
 * Returns true when earlier is strictly before later (or equal if allowEqual).
 */
function isDateBefore(earlier, later, { allowEqual = false } = {}) {
  const a = parseDateFlexible(earlier);
  const b = parseDateFlexible(later);
  if (!a || !b) return false;
  const diff = a.getTime() - b.getTime();
  return allowEqual ? diff <= 0 : diff < 0;
}

function isPlausibleDob(value, { minAge = 0, maxAge = 120, asOf = new Date() } = {}) {
  const dob = parseDateFlexible(value);
  if (!dob) return false;
  if (dob.getTime() > asOf.getTime()) return false;
  const ageYears = (asOf.getTime() - dob.getTime()) / (365.25 * 24 * 3600 * 1000);
  return ageYears >= minAge && ageYears <= maxAge;
}

/**
 * Build a structured date-order check result.
 */
function checkDateOrder(earlier, later, { label = 'date order', allowEqual = false } = {}) {
  if (!earlier || !later) {
    return { name: label, passed: true, reason: null, skipped: true };
  }
  if (!isValidDate(earlier) || !isValidDate(later)) {
    return {
      name: label,
      passed: false,
      reason: `Invalid date(s) for ${label}`,
      code: 'INVALID_DATE',
    };
  }
  const ok = isDateBefore(earlier, later, { allowEqual });
  return {
    name: label,
    passed: ok,
    reason: ok ? null : `${label}: expected earlier date before later date`,
    code: ok ? null : 'DATE_ORDER_INVALID',
  };
}

module.exports = {
  parseDateFlexible,
  isValidDate,
  isDateBefore,
  isPlausibleDob,
  checkDateOrder,
};

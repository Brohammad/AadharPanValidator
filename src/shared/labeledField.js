/** Labeled field extraction from OCR text */

/**
 * Extract a value following any of the given label patterns.
 * @param {string} text
 * @param {RegExp[]} labelPatterns
 * @param {{ maxLen?: number, nextLine?: boolean, clean?: (s: string) => string }} [options]
 */
function extractLabeledValue(text, labelPatterns, options = {}) {
  const maxLen = options.maxLen ?? 120;
  const nextLine = options.nextLine !== false;
  const clean = options.clean || ((s) => s.replace(/\s+/g, ' ').trim());

  for (const re of labelPatterns || []) {
    const pattern = new RegExp(`${re.source}\\s*[:\\-/>|.]?\\s*([^\\n]{0,${maxLen}})`, 'i');
    const m = text.match(pattern);
    if (m) {
      let value = clean(m[1] || '');
      if (value && !/^(n\/a|na|none|-)$/i.test(value)) return value.slice(0, maxLen);

      if (nextLine) {
        const idx = m.index ?? 0;
        const after = text.slice(idx + m[0].length);
        const line = after.split('\n').find((l) => l.trim().length > 1);
        if (line) {
          value = clean(line);
          if (value) return value.slice(0, maxLen);
        }
      }
    }
  }
  return null;
}

/**
 * Extract multiple labeled list items (e.g. directors).
 */
function extractLabeledList(text, labelPatterns, options = {}) {
  const maxItems = options.maxItems ?? 20;
  for (const re of labelPatterns || []) {
    const idx = text.search(re);
    if (idx < 0) continue;
    const block = text.slice(idx).split('\n').slice(0, 25);
    const items = [];
    for (const line of block.slice(1)) {
      const cleaned = line
        .replace(/^[\d.\-)\]\s]+/, '')
        .replace(/^[-*•]\s*/, '')
        .trim();
      if (!cleaned || cleaned.length < 3) continue;
      if (/^(Director|Signator|Name|S\.?\s*No)/i.test(cleaned) && cleaned.length < 20) continue;
      if (/^[A-Z0-9\s.,'&\-]{3,80}$/i.test(cleaned) || /[A-Za-z]{3,}/.test(cleaned)) {
        items.push(cleaned.slice(0, 120));
      }
      if (items.length >= maxItems) break;
      if (/^(Authorized|Paid|Capital|Address|CIN|ROC)\b/i.test(cleaned)) break;
    }
    if (items.length) return items;
  }
  return [];
}

module.exports = {
  extractLabeledValue,
  extractLabeledList,
};

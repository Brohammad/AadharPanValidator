/** Table / section / bullet heuristics from OCR plain text */

function extractSectionHeadings(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const headings = [];
  for (const line of lines) {
    if (line.length < 4 || line.length > 80) continue;
    const isNumbered = /^\d+(\.\d+)*[.)]\s+\S/.test(line);
    const isAllCaps = /^[A-Z0-9][A-Z0-9\s\-:&/]{3,}$/.test(line) && /[A-Z]{3,}/.test(line);
    const isTitleCase = /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,6}$/.test(line);
    if (isNumbered || (isAllCaps && line.split(/\s+/).length <= 10) || isTitleCase) {
      if (!/^\d{1,2}[\/\-]\d{1,2}/.test(line)) headings.push(line);
    }
  }
  return [...new Set(headings)].slice(0, 40);
}

function extractBulletLists(text) {
  const lines = text.split('\n');
  const bullets = [];
  for (const line of lines) {
    const m = line.match(/^\s*(?:[-*•●▪]|[a-z]\)|\d+[.)])\s+(.+)$/i);
    if (m && m[1].trim().length > 2) bullets.push(m[1].trim().slice(0, 200));
  }
  return [...new Set(bullets)].slice(0, 50);
}

/**
 * Heuristic tables: consecutive lines with 2+ whitespace-separated columns
 * or pipe/tab separators.
 */
function extractTables(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const tables = [];
  let current = [];

  function flush() {
    if (current.length >= 2) {
      tables.push({
        rowCount: current.length,
        rows: current.slice(0, 30),
      });
    }
    current = [];
  }

  for (const line of lines) {
    const pipeCols = line.split('|').map((c) => c.trim()).filter(Boolean);
    const tabCols = line.split(/\t+/).filter(Boolean);
    const spaceCols = line.split(/\s{2,}/).filter(Boolean);
    const cols =
      pipeCols.length >= 2 ? pipeCols : tabCols.length >= 2 ? tabCols : spaceCols.length >= 2 ? spaceCols : null;

    if (cols && cols.length >= 2) {
      current.push(cols);
    } else {
      flush();
    }
  }
  flush();
  return tables.slice(0, 10);
}

function extractHeaders(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.slice(0, 3);
}

function extractFooters(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.slice(-3);
}

module.exports = {
  extractSectionHeadings,
  extractBulletLists,
  extractTables,
  extractHeaders,
  extractFooters,
};

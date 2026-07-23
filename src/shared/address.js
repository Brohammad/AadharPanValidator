/** Address block extraction from OCR text */

function extractAddressAfterLabel(text, labels = [/Address/i, /Registered\s*Office/i, /पता/]) {
  for (const re of labels) {
    const idx = text.search(re);
    if (idx < 0) continue;
    const block = text.slice(idx).split('\n').slice(0, 8);
    const lines = block
      .map((l) => l.replace(re, '').replace(/^[:\-\s]+/, '').trim())
      .filter((l) => l.length > 5 && !/^(Address|Registered|Office)$/i.test(l));
    if (lines.length > 0) return lines.join(', ').slice(0, 400);
  }
  return null;
}

function extractAddresses(text) {
  const addresses = [];
  const labeled = extractAddressAfterLabel(text);
  if (labeled) addresses.push(labeled);

  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    if (/\b\d{6}\b/.test(lines[i]) || /\bPIN\b|\bZIP\b/i.test(lines[i])) {
      const chunk = lines.slice(Math.max(0, i - 2), i + 1).join(', ');
      if (chunk.length > 15) addresses.push(chunk.slice(0, 400));
    }
  }

  const seen = new Set();
  return addresses.filter((a) => {
    const key = a.toUpperCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = {
  extractAddressAfterLabel,
  extractAddresses,
};

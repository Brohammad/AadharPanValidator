/** Keyword scoring for document identification */

/**
 * @param {string} text
 * @param {{ pattern: RegExp, score: number, label?: string }[]} rules
 * @returns {number} clamped 0–100
 */
function scoreKeywords(text, rules) {
  return scoreKeywordsDetailed(text, rules).score;
}

/**
 * Weighted keyword scoring with explainable match reasons.
 * @returns {{ score: number, reasons: string[], signals: Record<string, boolean>, matchCount: number }}
 */
function scoreKeywordsDetailed(text, rules) {
  if (!text || !rules?.length) {
    return { score: 0, reasons: [], signals: {}, matchCount: 0 };
  }

  let score = 0;
  const reasons = [];
  const signals = {};
  let matchCount = 0;

  for (const rule of rules) {
    if (!rule.pattern?.test(text)) continue;
    score += rule.score;
    matchCount += 1;
    const label =
      rule.label ||
      (rule.pattern.source ? `Matched /${rule.pattern.source}/` : 'Matched keyword');
    reasons.push(label);
    if (rule.signal) signals[rule.signal] = true;
  }

  return {
    score: Math.min(score, 100),
    reasons,
    signals,
    matchCount,
  };
}

module.exports = { scoreKeywords, scoreKeywordsDetailed };

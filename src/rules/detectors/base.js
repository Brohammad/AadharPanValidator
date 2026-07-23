function createResult(name, score, passed, weight, details = {}, fraudMessage = null) {
  return {
    name,
    score: Math.round(score * 1000) / 1000,
    passed,
    weight,
    details,
    fraudMessage: passed ? null : fraudMessage,
  };
}

module.exports = { createResult };

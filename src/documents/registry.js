const AadhaarDocument = require('./aadhaarDocument');
const PanDocument = require('./panDocument');

const DocumentRegistry = [new AadhaarDocument(), new PanDocument()];

// Lowered: valid PAN/Aadhaar numbers alone should classify hard CamScanner photos
const IDENTIFY_THRESHOLD = 20;

function identifyDocument(features, ocr) {
  const scores = DocumentRegistry.map((doc) => ({
    document: doc,
    type: doc.type,
    score: doc.identify(features, ocr),
  }));

  scores.sort((a, b) => b.score - a.score);
  const best = scores[0];

  if (!best || best.score < IDENTIFY_THRESHOLD) {
    return { document: null, type: 'UNKNOWN', score: best?.score || 0, allScores: scores };
  }

  return { document: best.document, type: best.type, score: best.score, allScores: scores };
}

module.exports = { DocumentRegistry, identifyDocument, IDENTIFY_THRESHOLD };

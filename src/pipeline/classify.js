const config = require('../config');
const { DocumentRegistry } = require('../documents/registry');

/**
 * Normalize identify() return value to { score, reasons, signals }.
 */
function normalizeIdentifyResult(doc, raw) {
  if (raw == null) return { score: 0, reasons: [], signals: {}, matchCount: 0 };
  if (typeof raw === 'number') {
    return {
      score: raw,
      reasons: raw > 0 ? [`${doc.label} identify score ${raw}`] : [],
      signals: {},
      matchCount: raw > 0 ? 1 : 0,
    };
  }
  return {
    score: raw.score || 0,
    reasons: raw.reasons || [],
    signals: raw.signals || {},
    matchCount: raw.matchCount ?? (raw.reasons?.length || 0),
  };
}

/**
 * Soft multi-signal adjustments on top of document identify().
 * Uses OCR confidence, layout cues, and logo hints — never a single keyword alone.
 */
function applyContextSignals(base, features, ocr) {
  let score = base.score;
  const reasons = [...base.reasons];
  const signals = { ...base.signals };
  const ocrConf = ocr?.ocrConfidence ?? features?.ocrConfidence ?? 0;

  if (ocrConf >= 70) {
    score = Math.min(100, score + 5);
    reasons.push(`OCR confidence ${ocrConf}% supports classification`);
    signals.highOcrConfidence = true;
  } else if (ocrConf > 0 && ocrConf < 45) {
    score = Math.max(0, score - 8);
    reasons.push(`Low OCR confidence ${ocrConf}% reduces classification confidence`);
    signals.lowOcrConfidence = true;
  }

  if (features?.signals?.hasPhotoLikeRegion) {
    score = Math.min(100, score + 3);
    reasons.push('Photo-like region detected (layout cue)');
    signals.photoLayout = true;
  }
  if (features?.signals?.hasQrLikeRegion) {
    score = Math.min(100, score + 2);
    reasons.push('QR-like region detected (layout cue)');
    signals.qrLayout = true;
  }
  if (features?.logoMatches?.length) {
    score = Math.min(100, score + 8);
    reasons.push(`Logo match: ${features.logoMatches.slice(0, 2).join(', ')}`);
    signals.logoDetected = true;
  }

  const dims = features?.imageQuality?.resolution || features?.metadata;
  if (dims?.width && dims?.height) {
    const ratio = dims.width / dims.height;
    if (ratio > 1.3 && ratio < 1.9) {
      score = Math.min(100, score + 2);
      reasons.push('Document aspect ratio consistent with ID card');
      signals.cardAspect = true;
    }
  }

  return { score: Math.round(Math.min(100, Math.max(0, score))), reasons, signals };
}

/**
 * Score the requested document type and optionally rank all registered types
 * for transparency. Does not force a type — caller decides whether to continue.
 */
function classifyDocument(requestedDocument, features, ocr) {
  const allScores = DocumentRegistry.map((doc) => {
    const result = applyContextSignals(
      normalizeIdentifyResult(doc, doc.identify(features, ocr)),
      features,
      ocr
    );
    return {
      type: doc.type,
      label: doc.label,
      mode: doc.mode,
      score: result.score,
      reasons: result.reasons,
      signals: result.signals,
    };
  }).sort((a, b) => b.score - a.score);

  const requested = applyContextSignals(
    normalizeIdentifyResult(
      requestedDocument,
      requestedDocument.identify(features, ocr)
    ),
    features,
    ocr
  );

  const best = allScores[0] || null;
  const threshold = config.classificationThreshold;
  const mismatchMargin = config.classificationMismatchMargin ?? 15;
  const distinctSignals = Object.keys(requested.signals).length;
  // Never pass on a single weak keyword alone — require 2+ signals or a decisive score
  const multiSignalOk = distinctSignals >= 2 || requested.score >= 50;
  let passed = requested.score >= threshold && multiSignalOk;

  const reasons = [...requested.reasons];
  if (requested.score >= threshold && !multiSignalOk) {
    passed = false;
    reasons.push('Classification rejected: fewer than 2 independent signals (avoid single-keyword guess)');
  }

  // Reject wrong endpoint: another type clearly fits better (e.g. passport on /api/aadhaar)
  if (
    passed &&
    best &&
    best.type !== requestedDocument.type &&
    best.score >= threshold &&
    best.score >= requested.score + mismatchMargin
  ) {
    passed = false;
    reasons.push(
      `Document type mismatch: stronger match for ${best.type} (score ${best.score}) than requested ${requestedDocument.type} (${requested.score})`
    );
  }

  if (requested.signals?.wrongDocType) {
    passed = false;
  }

  if (!passed) {
    if (!reasons.some((r) => /below threshold|mismatch|rejected/i.test(r))) {
      reasons.push(
        `Classification confidence ${requested.score} below threshold ${threshold} for ${requestedDocument.type}`
      );
    }
    if (best && best.type !== requestedDocument.type && best.score >= threshold) {
      reasons.push(
        `Stronger match for ${best.type} (score ${best.score}) than requested ${requestedDocument.type}`
      );
    } else if (!best || best.score < threshold) {
      reasons.push('Insufficient matching keywords / layout / ID patterns');
    }
  }

  return {
    passed,
    requestedType: requestedDocument.type,
    documentType: passed ? requestedDocument.type : 'UNKNOWN',
    classificationConfidence: requested.score,
    threshold,
    reasons,
    signals: requested.signals,
    matchedKeywords: requested.reasons.filter((r) =>
      /keyword|matched|regex|pattern|logo|layout|mrz|pan|aadhaar|cin/i.test(r)
    ),
    allScores: allScores.map((s) => ({
      type: s.type,
      score: s.score,
      reasons: s.reasons.slice(0, 5),
    })),
    bestAlternative: best && best.type !== requestedDocument.type ? best : null,
  };
}

module.exports = { classifyDocument, normalizeIdentifyResult, applyContextSignals };

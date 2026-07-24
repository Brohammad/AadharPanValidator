const config = require('../config');
const { DocumentRegistry } = require('../documents/registry');

/**
 * Convert identify() signals object into matchedSignals array.
 */
function toMatchedSignals(signals = {}, reasons = []) {
  if (Array.isArray(signals)) return signals;
  const matched = [];
  for (const [id, val] of Object.entries(signals)) {
    if (!val) continue;
    if (typeof val === 'object' && val.matched != null) {
      matched.push(val);
      continue;
    }
    matched.push({
      id,
      weight: typeof val === 'number' ? val : 1,
      matched: true,
      detail: reasons.find((r) =>
        typeof r === 'string'
          ? new RegExp(id, 'i').test(r)
          : new RegExp(id, 'i').test(r.message || '')
      ) || id,
    });
  }
  return matched;
}

/**
 * Normalize identify() return value to { score, reasons, signals, matchedSignals }.
 */
function normalizeIdentifyResult(doc, raw) {
  if (raw == null) {
    return { score: 0, reasons: [], signals: {}, matchedSignals: [], matchCount: 0 };
  }
  if (typeof raw === 'number') {
    return {
      score: raw,
      reasons: raw > 0
        ? [{ code: 'IDENTIFY_SCORE', message: `${doc.label} identify score ${raw}`, stage: 'classification' }]
        : [],
      signals: {},
      matchedSignals: [],
      matchCount: raw > 0 ? 1 : 0,
    };
  }

  const reasons = (raw.reasons || []).map((r) =>
    typeof r === 'string'
      ? { code: 'SIGNAL_MATCH', message: r, stage: 'classification' }
      : r
  );

  return {
    score: raw.score || 0,
    reasons,
    signals: raw.signals || {},
    matchedSignals: raw.matchedSignals || toMatchedSignals(raw.signals || {}, reasons),
    matchCount: raw.matchCount ?? reasons.length,
  };
}

/**
 * Soft multi-signal adjustments on top of document identify().
 * Weights come from config.classification.signalWeights.
 */
function applyContextSignals(base, features, ocr) {
  let score = base.score;
  const reasons = [...base.reasons];
  const signals = { ...base.signals };
  const matchedSignals = [...(base.matchedSignals || [])];
  const weights = config.classification?.signalWeights || {};
  const ocrConf = ocr?.ocrConfidence ?? features?.ocrConfidence ?? 0;
  const highMin = config.classification?.highOcrConfidenceMin ?? 70;
  const lowMax = config.classification?.lowOcrConfidenceMax ?? 45;

  if (ocrConf >= highMin) {
    const w = weights.highOcrConfidence ?? 5;
    score = Math.min(100, score + w);
    reasons.push({
      code: 'HIGH_OCR_CONFIDENCE',
      message: `OCR confidence ${ocrConf}% supports classification`,
      stage: 'classification',
    });
    signals.highOcrConfidence = true;
    matchedSignals.push({ id: 'highOcrConfidence', weight: w, matched: true, detail: `OCR ${ocrConf}%` });
  } else if (ocrConf > 0 && ocrConf < lowMax) {
    const w = weights.lowOcrConfidence ?? -8;
    score = Math.max(0, score + w);
    reasons.push({
      code: 'LOW_OCR_CONFIDENCE',
      message: `Low OCR confidence ${ocrConf}% reduces classification confidence`,
      stage: 'classification',
    });
    signals.lowOcrConfidence = true;
    matchedSignals.push({ id: 'lowOcrConfidence', weight: w, matched: true, detail: `OCR ${ocrConf}%` });
  }

  if (features?.signals?.hasPhotoLikeRegion) {
    const w = weights.photoLayout ?? 3;
    score = Math.min(100, score + w);
    reasons.push({
      code: 'PHOTO_LAYOUT',
      message: 'Photo-like region detected (layout cue)',
      stage: 'classification',
    });
    signals.photoLayout = true;
    matchedSignals.push({ id: 'photoLayout', weight: w, matched: true, detail: 'photo region' });
  }
  if (features?.signals?.hasQrLikeRegion) {
    const w = weights.qrLayout ?? 2;
    score = Math.min(100, score + w);
    reasons.push({
      code: 'QR_LAYOUT',
      message: 'QR-like region detected (layout cue)',
      stage: 'classification',
    });
    signals.qrLayout = true;
    matchedSignals.push({ id: 'qrLayout', weight: w, matched: true, detail: 'QR region' });
  }
  if (features?.logoMatches?.length) {
    const w = weights.logoDetected ?? 8;
    score = Math.min(100, score + w);
    reasons.push({
      code: 'LOGO_DETECTED',
      message: `Logo match: ${features.logoMatches.slice(0, 2).join(', ')}`,
      stage: 'classification',
    });
    signals.logoDetected = true;
    matchedSignals.push({
      id: 'logoDetected',
      weight: w,
      matched: true,
      detail: features.logoMatches.slice(0, 2).join(', '),
    });
  }

  const dims = features?.imageQuality?.resolution || features?.metadata;
  if (dims?.width && dims?.height) {
    const ratio = dims.width / dims.height;
    if (ratio > 1.3 && ratio < 1.9) {
      const w = weights.cardAspect ?? 2;
      score = Math.min(100, score + w);
      reasons.push({
        code: 'CARD_ASPECT',
        message: 'Document aspect ratio consistent with ID card',
        stage: 'classification',
      });
      signals.cardAspect = true;
      matchedSignals.push({ id: 'cardAspect', weight: w, matched: true, detail: `ratio ${ratio.toFixed(2)}` });
    }
  }

  return {
    score: Math.round(Math.min(100, Math.max(0, score))),
    reasons,
    signals,
    matchedSignals,
  };
}

/**
 * Score the requested document type (type-fit gate). UNKNOWN when below threshold.
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
      matchedSignals: result.matchedSignals,
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
  const minSignals = config.classificationMinSignals ?? 2;
  const decisiveScore = config.classificationDecisiveScore ?? 50;
  const distinctSignals = Object.keys(requested.signals).filter(
    (k) => requested.signals[k] && k !== 'wrongDocType'
  ).length;
  const multiSignalOk = distinctSignals >= minSignals || requested.score >= decisiveScore;
  let passed = requested.score >= threshold && multiSignalOk;

  const reasons = [...requested.reasons];
  if (requested.score >= threshold && !multiSignalOk) {
    passed = false;
    reasons.push({
      code: 'INSUFFICIENT_SIGNALS',
      message: `Classification rejected: fewer than ${minSignals} independent signals (avoid single-keyword guess)`,
      stage: 'classification',
    });
  }

  if (
    passed &&
    best &&
    best.type !== requestedDocument.type &&
    best.score >= threshold &&
    best.score >= requested.score + mismatchMargin
  ) {
    passed = false;
    reasons.push({
      code: 'LAYOUT_MISMATCH',
      message: `Document type mismatch: stronger match for ${best.type} (score ${best.score}) than requested ${requestedDocument.type} (${requested.score})`,
      stage: 'classification',
    });
  }

  if (requested.signals?.wrongDocType) {
    passed = false;
    reasons.push({
      code: 'WRONG_DOC_TYPE',
      message: 'Hard negative signals indicate a different document type',
      stage: 'classification',
    });
  }

  if (!passed) {
    if (!reasons.some((r) => /below threshold|mismatch|rejected|INSUFFICIENT|LAYOUT|WRONG/i.test(r.message || r))) {
      reasons.push({
        code: 'BELOW_THRESHOLD',
        message: `Classification confidence ${requested.score} below threshold ${threshold} for ${requestedDocument.type}`,
        stage: 'classification',
      });
    }
    if (best && best.type !== requestedDocument.type && best.score >= threshold) {
      reasons.push({
        code: 'BETTER_ALTERNATIVE',
        message: `Stronger match for ${best.type} (score ${best.score}) than requested ${requestedDocument.type}`,
        stage: 'classification',
      });
    } else if (!best || best.score < threshold) {
      reasons.push({
        code: 'INSUFFICIENT_MATCHING_SIGNALS',
        message: 'Insufficient matching keywords / layout / ID patterns',
        stage: 'classification',
      });
    }
  }

  return {
    passed,
    requestedType: requestedDocument.type,
    documentType: passed ? requestedDocument.type : 'UNKNOWN',
    classificationConfidence: requested.score,
    threshold,
    reasons,
    reasoning: reasons,
    signals: requested.signals,
    matchedSignals: requested.matchedSignals,
    matchedKeywords: reasons
      .map((r) => (typeof r === 'string' ? r : r.message))
      .filter((r) =>
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

module.exports = {
  classifyDocument,
  normalizeIdentifyResult,
  applyContextSignals,
  toMatchedSignals,
};

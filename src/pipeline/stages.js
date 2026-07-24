/**
 * Named pipeline stage helpers — keep orchestrator linear and document-agnostic.
 */
const { prepareImages } = require('../preprocessing/pdf');
const { analyzeImageQuality } = require('../preprocessing/quality');
const { preprocessChain, rebuildPageAtAngle, isIdCardType } = require('../preprocessing/chain');
const { runOcrOnPages, scoreOcrResult } = require('../ocr/tesseract');
const { extractFeatures } = require('../features/extractFeatures');
const { evaluateOcrQuality } = require('./ocrQuality');
const { classifyDocument } = require('./classify');
const { scoreExtractionConfidence } = require('./extractionConfidence');
const { mergeWithGenerics } = require('../shared/genericExtract');
const { runRuleEngine } = require('../rules/engine');
const { aggregateScores, buildDecision } = require('../rules/aggregator');
const config = require('../config');

function hasIdOcrCues(text) {
  const upper = String(text || '').toUpperCase();
  return /INCOME|TAX|GOVT|FATHER|PEMANENT|PERMANENT|ACCOUNT|AADHAAR|AADHAR|UIDAI|DOB|[A-Z]{5}[0-9OISB]{4}[A-Z]|\d{4}[\s\-]?\d{4}[\s\-]?\d{4}/i.test(
    upper
  );
}

function ocrLooksWeak(ocrResult) {
  const text = String(ocrResult?.text || '');
  if (hasIdOcrCues(text)) return false;
  const alnum = (text.match(/[A-Za-z0-9]/g) || []).length;
  const score = scoreOcrResult(ocrResult || { text: '', ocrConfidence: 0 });
  return alnum < 40 || score < 50 || (ocrResult?.ocrConfidence || 0) < 45;
}

function shouldRetryOrientation(ocrResult) {
  const text = String(ocrResult?.text || '');
  const alnum = (text.match(/[A-Za-z0-9]/g) || []).length;
  const conf = ocrResult?.ocrConfidence || 0;
  if (alnum < 40) return true;
  if (conf < 20 && alnum < 80) return true;
  return false;
}

async function stagePreparePages(filePath, requestId) {
  return prepareImages(filePath, requestId);
}

async function stagePreprocess(images, { source, documentType, maxVariants = 1 }) {
  const idCard = isIdCardType(documentType);
  const variants = source === 'image' || idCard ? Math.max(maxVariants, 2) : maxVariants;

  const processedPages = [];
  for (const img of images) {
    processedPages.push(
      await preprocessChain(img, {
        source,
        documentType,
        maxVariants: variants,
      })
    );
  }
  const imageQuality = await analyzeImageQuality(processedPages[0].processedBuffer);
  return { processedPages, imageQuality };
}

async function stageOcr(processedPages, options = {}) {
  const ocrOptions = {
    fast: true,
    maxVariants: 1,
    goodEnoughScore: config.ocrFastGoodEnoughScore,
    ...options,
  };
  return runOcrOnPages(
    processedPages.map((p) => p.ocrBuffer),
    processedPages.map((p) => (p.ocrVariants || [p.ocrBuffer]).slice(0, ocrOptions.maxVariants)),
    ocrOptions
  );
}

/**
 * OCR each page separately and keep the best-scoring page confidence,
 * while merging page texts (helps 2-sided Aadhaar PDFs).
 */
async function stageOcrBestPage(processedPages, options = {}) {
  if (processedPages.length <= 1) {
    return stageOcr(processedPages, {
      ...options,
      maxVariants: options.maxVariants || 2,
    });
  }

  let best = null;
  let bestScore = -Infinity;
  const pageTexts = [];

  for (const page of processedPages) {
    const result = await runOcrOnPages(
      [page.ocrBuffer],
      [(page.ocrVariants || [page.ocrBuffer]).slice(0, options.maxVariants || 2)],
      {
        fast: options.fast !== false,
        maxVariants: options.maxVariants || 2,
        goodEnoughScore: options.goodEnoughScore ?? config.ocrFastGoodEnoughScore,
      }
    );
    const score = scoreOcrResult(result);
    pageTexts.push(result.text || '');
    if (score > bestScore) {
      bestScore = score;
      best = result;
    }
  }

  if (!best) return stageOcr(processedPages, options);

  const merged = [...new Set(pageTexts.filter(Boolean))].join('\n\n');
  return {
    ...best,
    text: merged || best.text,
    pages: processedPages.map((_, i) => ({ text: pageTexts[i] })),
  };
}

async function stageRetryOrientationIfNeeded(processedPages, ocrResult, source, imageQuality, documentType) {
  if (source !== 'embedded' && source !== 'pdf') {
    return { processedPages, ocrResult, imageQuality };
  }
  if (!shouldRetryOrientation(ocrResult)) {
    return { processedPages, ocrResult, imageQuality };
  }

  const current = processedPages[0].orientationAngle || 0;
  const alternate = current === 270 ? 0 : 270;

  const page = await rebuildPageAtAngle(processedPages[0].originalBuffer, alternate, {
    source,
    documentType,
    maxVariants: isIdCardType(documentType) ? 2 : 1,
  });
  const nextOcr = await runOcrOnPages(
    [page.ocrBuffer],
    [page.ocrVariants.slice(0, 2)],
    {
      fast: true,
      maxVariants: 2,
      goodEnoughScore: config.ocrFastGoodEnoughScore,
    }
  );

  if (scoreOcrResult(nextOcr) > scoreOcrResult(ocrResult)) {
    return {
      processedPages: [page, ...processedPages.slice(1)],
      ocrResult: nextOcr,
      imageQuality: await analyzeImageQuality(page.processedBuffer),
    };
  }

  return { processedPages, ocrResult, imageQuality };
}

/**
 * Escalation for weak ID-card OCR (photo-in-PDF Aadhaar/PAN):
 * try upright angles + photo variants + slower PSM, keep the best score.
 */
async function stageEscalateIdCardOcr(processedPages, ocrResult, source, imageQuality, documentType) {
  if (!isIdCardType(documentType)) {
    return { processedPages, ocrResult, imageQuality, escalated: false };
  }
  const currentScore = scoreOcrResult(ocrResult);
  // Skip when already readable or ID cues present (avoid 60s+ angle thrash)
  if (
    hasIdOcrCues(ocrResult?.text) ||
    currentScore >= 70 ||
    (!ocrLooksWeak(ocrResult) && (ocrResult?.ocrConfidence || 0) >= config.ocrConfidenceThreshold)
  ) {
    return { processedPages, ocrResult, imageQuality, escalated: false };
  }

  const currentAngle = processedPages[0]?.orientationAngle || 0;
  // Only try the two most likely alternates (skip current)
  const angles = [270, 90, 0, 180].filter((a) => a !== currentAngle).slice(0, 2);
  let best = {
    processedPages,
    ocrResult,
    imageQuality,
    score: currentScore,
  };

  const primary = processedPages[0];
  for (const angle of angles) {
    const page = await rebuildPageAtAngle(primary.originalBuffer, angle, {
      source: source || 'embedded',
      documentType,
      maxVariants: 2,
    });
    const nextOcr = await runOcrOnPages(
      [page.ocrBuffer],
      [page.ocrVariants.slice(0, 2)],
      {
        fast: true,
        maxVariants: 2,
        goodEnoughScore: config.ocrFastGoodEnoughScore,
      }
    );
    const score = scoreOcrResult(nextOcr);
    const nextAlnum = ((nextOcr.text || '').match(/[A-Za-z0-9]/g) || []).length;
    if (nextAlnum < 12) continue;

    if (score > best.score + 5) {
      best = {
        processedPages: [page, ...processedPages.slice(1)],
        ocrResult: nextOcr,
        imageQuality: await analyzeImageQuality(page.processedBuffer),
        score,
      };
    }
    if (best.score >= 70) break;
  }

  return { ...best, escalated: true };
}

function stageOcrQuality(ocrResult, imageQuality) {
  return evaluateOcrQuality(ocrResult, imageQuality);
}

async function stageClassify(document, processedPages, ocrResult, imageQuality) {
  const features = await extractFeatures(
    processedPages[0].processedBuffer,
    ocrResult,
    imageQuality
  );
  const classification = classifyDocument(document, features, ocrResult);
  return { features, classification };
}

function stageExtract(document, ocrResult, features) {
  const extraction = document.extract(ocrResult, features);
  let data = mergeWithGenerics(extraction.data, ocrResult, features);

  let extractionConfidence = extraction.extractionConfidence;
  let extractionReasons = extraction.extractionReasons || [];
  let extractionIssues = extraction.extractionIssues || [];
  let extractionBelowThreshold =
    extraction.extractionBelowThreshold ??
    extractionConfidence < config.extractionThreshold;

  if (!extraction.extractionReasons && extraction.mandatoryFields) {
    const scored = scoreExtractionConfidence({
      ocrConfidence: ocrResult.ocrConfidence,
      mandatoryFields: extraction.mandatoryFields,
      optionalFields: extraction.optionalFields || [],
      data: extraction.data,
      formatChecks: extraction.formatChecks || [],
      consistencyChecks: extraction.consistencyChecks || [],
      hasDuplicates: extraction.hasDuplicates || false,
      labelProximityOk: extraction.labelProximityOk,
      mandatoryWeight: extraction.mandatoryWeight,
      optionalWeight: extraction.optionalWeight,
      ocrWeight: extraction.ocrWeight,
      issues: extractionIssues,
    });
    extractionConfidence = scored.extractionConfidence;
    extractionReasons = scored.extractionReasons;
    extractionIssues = scored.extractionIssues;
    extractionBelowThreshold = scored.extractionBelowThreshold;
  } else if (!extractionReasons.length) {
    extractionBelowThreshold = extractionConfidence < config.extractionThreshold;
    if (extractionBelowThreshold) {
      extractionReasons = [
        {
          code: 'EXTRACTION_BELOW_THRESHOLD',
          impact: 0,
          message: `Extraction confidence ${extractionConfidence}% below threshold ${config.extractionThreshold}%`,
          stage: 'extraction',
        },
      ];
    }
    if (ocrResult.ocrConfidence > 0 && ocrResult.ocrConfidence < 50) {
      extractionReasons.push({
        code: 'AMBIGUOUS_OCR',
        impact: 0,
        message: `Ambiguous OCR (confidence ${ocrResult.ocrConfidence}%)`,
        stage: 'extraction',
      });
    }
  }

  return {
    data,
    extractionConfidence,
    extractionReasons,
    extractionIssues,
    extractionBelowThreshold,
  };
}

function stageValidate(document, data) {
  if (!document.supportsValidation) {
    return { passed: true, checks: {}, reasons: [], reason: null, skipped: true };
  }
  const result = document.validate(data);
  const reasons = result.reasons || [];
  if (result.reason && !reasons.length) {
    reasons.push({
      code: result.passed ? 'VALIDATION_PASS' : 'VALIDATION_FAIL',
      message: result.reason,
      stage: 'validation',
    });
  }
  return { ...result, reasons };
}

async function stageRiskAssess(document, ctx) {
  if (document.mode !== 'verification') {
    return {
      detectorResults: [],
      aggregation: {
        fraudIndicators: [],
        qualityWarnings: [],
        categoryScores: {},
        checks: {},
        riskScore: null,
        reasoning: [],
      },
      decision: null,
    };
  }

  const detectorNames = [
    ...new Set(
      typeof document.riskChecks === 'function'
        ? document.riskChecks()
        : document.authenticityChecks()
    ),
  ];
  const detectorResults = await runRuleEngine(ctx, detectorNames);
  const aggregation = aggregateScores(detectorResults);
  const decision = buildDecision(ctx.validationResult, aggregation);
  return { detectorResults, aggregation, decision };
}

module.exports = {
  ocrLooksWeak,
  shouldRetryOrientation,
  stagePreparePages,
  stagePreprocess,
  stageOcr,
  stageOcrBestPage,
  stageRetryOrientationIfNeeded,
  stageEscalateIdCardOcr,
  stageOcrQuality,
  stageClassify,
  stageExtract,
  stageValidate,
  stageRiskAssess,
};

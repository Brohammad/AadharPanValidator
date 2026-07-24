/**
 * Named pipeline stage helpers — keep orchestrator linear and document-agnostic.
 */
const { prepareImages } = require('../preprocessing/pdf');
const { analyzeImageQuality } = require('../preprocessing/quality');
const { preprocessChain, rebuildPageAtAngle } = require('../preprocessing/chain');
const { runOcrOnPages, scoreOcrResult } = require('../ocr/tesseract');
const { extractFeatures } = require('../features/extractFeatures');
const { evaluateOcrQuality } = require('./ocrQuality');
const { classifyDocument } = require('./classify');
const { scoreExtractionConfidence } = require('./extractionConfidence');
const { mergeWithGenerics } = require('../shared/genericExtract');
const { runRuleEngine } = require('../rules/engine');
const { aggregateScores, buildDecision } = require('../rules/aggregator');
const config = require('../config');

function ocrLooksWeak(ocrResult) {
  const text = String(ocrResult?.text || '');
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
  const processedPages = [];
  for (const img of images) {
    processedPages.push(
      await preprocessChain(img, {
        source,
        documentType,
        maxVariants: source === 'image' ? Math.max(maxVariants, 1) : maxVariants,
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
    maxVariants: 1,
  });
  const nextOcr = await runOcrOnPages(
    [page.ocrBuffer],
    [page.ocrVariants.slice(0, 1)],
    {
      fast: true,
      maxVariants: 1,
      goodEnoughScore: config.ocrFastGoodEnoughScore,
    }
  );
  const nextScore = scoreOcrResult(nextOcr);
  const curScore = scoreOcrResult(ocrResult);

  if (nextScore > curScore) {
    return {
      processedPages: [page],
      ocrResult: nextOcr,
      imageQuality: await analyzeImageQuality(page.processedBuffer),
    };
  }

  return { processedPages, ocrResult, imageQuality };
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

  // Prefer plugin-provided reasons; otherwise score centrally when fields declared
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
    const scored = scoreExtractionConfidence({
      ocrConfidence: ocrResult.ocrConfidence,
      mandatoryFields: [],
      optionalFields: [],
      data: extraction.data,
      issues: extractionIssues,
      mandatoryWeight: 0,
      optionalWeight: 0,
      ocrWeight: 0,
    });
    // Keep plugin score but attach threshold reason if needed
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
    void scored;
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
  return {
    ...result,
    reasons,
  };
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
  stageRetryOrientationIfNeeded,
  stageOcrQuality,
  stageClassify,
  stageExtract,
  stageValidate,
  stageRiskAssess,
};

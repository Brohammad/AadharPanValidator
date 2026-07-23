const Timings = require('../utils/timings');
const logger = require('../logger');
const { removeDir } = require('../utils/fileCleanup');
const { prepareImages } = require('../preprocessing/pdf');
const { analyzeImageQuality } = require('../preprocessing/quality');
const { preprocessChain, rebuildPageAtAngle } = require('../preprocessing/chain');
const { runOcrOnPages, scoreOcrResult } = require('../ocr/tesseract');
const { extractFeatures } = require('../features/extractFeatures');
const { getDocumentByType, getDocumentBySlug } = require('../documents/registry');
const { mergeWithGenerics } = require('../shared/genericExtract');
const { runRuleEngine } = require('../rules/engine');
const { aggregateScores, buildDecision } = require('../rules/aggregator');
const { evaluateOcrQuality } = require('./ocrQuality');
const { classifyDocument } = require('./classify');
const { buildStoppedResponse, buildCompletedResponse } = require('./responseBuilder');

function ocrLooksWeak(ocrResult) {
  const text = String(ocrResult?.text || '');
  const alnum = (text.match(/[A-Za-z0-9]/g) || []).length;
  const score = scoreOcrResult(ocrResult || { text: '', ocrConfidence: 0 });
  return alnum < 40 || score < 50 || (ocrResult?.ocrConfidence || 0) < 45;
}

/** Only retry rotation when OCR looks sideways/empty — not when upright but noisy. */
function shouldRetryOrientation(ocrResult) {
  const text = String(ocrResult?.text || '');
  const alnum = (text.match(/[A-Za-z0-9]/g) || []).length;
  const conf = ocrResult?.ocrConfidence || 0;
  if (alnum < 40) return true;
  if (conf < 20 && alnum < 80) return true;
  return false;
}

/**
 * If embedded/PDF OCR is weak, try ONE alternate orientation (cap latency).
 */
async function retryOrientationIfNeeded(processedPages, ocrResult, source, imageQuality, documentType) {
  if (source !== 'embedded' && source !== 'pdf') {
    return { processedPages, ocrResult, imageQuality };
  }
  if (!shouldRetryOrientation(ocrResult)) {
    return { processedPages, ocrResult, imageQuality };
  }

  const current = processedPages[0].orientationAngle || 0;
  // Prefer the usual sideways fix first
  const alternate = current === 270 ? 0 : 270;

  const page = await rebuildPageAtAngle(processedPages[0].originalBuffer, alternate, {
    source,
    documentType,
  });
  const nextOcr = await runOcrOnPages(
    [page.ocrBuffer],
    [page.ocrVariants.slice(0, 1)],
    { fast: true, maxVariants: 1, goodEnoughScore: 80 }
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

/**
 * Gated document pipeline (fast path):
 * preprocess (no OCR) → OCR → optional orientation retry → quality gate
 * → classify → extract → validate/auth (verification only)
 */
async function processDocument(filePath, filename, requestId, documentTypeOrSlug) {
  const document =
    getDocumentBySlug(documentTypeOrSlug) || getDocumentByType(documentTypeOrSlug);

  if (!document) {
    const err = new Error(
      `Unsupported document type "${documentTypeOrSlug}". Use GET /api/documents for the list.`
    );
    err.statusCode = 400;
    throw err;
  }

  const timings = new Timings();
  let tempDir = null;
  let stage = 'preprocess';

  const logStage = (extra = {}) => {
    logger.info({
      requestId,
      filename,
      requestedType: document.type,
      stage,
      ...extra,
    });
  };

  try {
    stage = 'preprocess';
    timings.start('preprocess');
    const { images, tempDir: workDir, source } = await prepareImages(filePath, requestId);
    tempDir = workDir;

    let processedPages = [];
    for (const img of images) {
      processedPages.push(
        await preprocessChain(img, { source, documentType: document.type })
      );
    }

    let imageQuality = await analyzeImageQuality(processedPages[0].processedBuffer);
    timings.end('preprocess');
    logStage({ durationMs: timings.toJSON().preprocess, source });

    stage = 'ocr';
    timings.start('ocr');
    const ocrOptions = {
      fast: true,
      maxVariants: 1,
      goodEnoughScore: 80,
    };
    let ocrResult = await runOcrOnPages(
      processedPages.map((p) => p.ocrBuffer),
      processedPages.map((p) => p.ocrVariants || [p.ocrBuffer]),
      ocrOptions
    );

    const retried = await retryOrientationIfNeeded(
      processedPages,
      ocrResult,
      source,
      imageQuality,
      document.type
    );
    processedPages = retried.processedPages;
    ocrResult = retried.ocrResult;
    imageQuality = retried.imageQuality;
    timings.end('ocr');

    let ocrQuality = evaluateOcrQuality(ocrResult, imageQuality);
    logStage({
      durationMs: timings.toJSON().ocr,
      ocrConfidence: ocrQuality.ocrConfidence,
      ocrPassed: ocrQuality.passed,
      alnumCount: ocrQuality.alnumCount,
      orientationAngle: processedPages[0].orientationAngle,
    });

    if (!ocrQuality.passed) {
      const stopped = buildStoppedResponse({
        stage: 'ocr',
        reason: 'OCR quality below configured threshold',
        reasons: ocrQuality.reasons,
        ocrConfidence: ocrQuality.ocrConfidence,
        imageQuality,
        timings: timings.toJSON(),
        fullOcrText: ocrQuality.fullOcrText,
        qualityWarnings: ocrQuality.warnings,
        orientationAngle: processedPages[0].orientationAngle,
      });
      logStage({ stopReason: stopped.reason, status: 'stopped' });
      return stopped;
    }

    // Always run passport refine (4 ROI OCRs) — base page OCR is often incomplete
    if (typeof document.refineOcr === 'function') {
      timings.start('refineOcr');
      try {
        ocrResult = await document.refineOcr(ocrResult, processedPages[0]);
      } catch (err) {
        logger.warn({ requestId, err: err.message }, 'refineOcr failed; continuing with base OCR');
      }
      timings.end('refineOcr');
    }

    stage = 'classification';
    timings.start('classification');
    const features = await extractFeatures(
      processedPages[0].processedBuffer,
      ocrResult,
      imageQuality
    );
    const classification = classifyDocument(document, features, ocrResult);
    timings.end('classification');

    logStage({
      durationMs: timings.toJSON().classification,
      classificationConfidence: classification.classificationConfidence,
      classificationPassed: classification.passed,
      documentType: classification.documentType,
    });

    if (!classification.passed) {
      const stopped = buildStoppedResponse({
        stage: 'classification',
        reason: 'Classification confidence below threshold',
        reasons: classification.reasons,
        ocrConfidence: ocrResult.ocrConfidence,
        classification,
        imageQuality,
        timings: timings.toJSON(),
        fullOcrText: ocrResult.text || '',
        qualityWarnings: ocrQuality.warnings,
        orientationAngle: processedPages[0].orientationAngle,
      });
      logStage({ stopReason: stopped.reason, status: 'stopped' });
      return stopped;
    }

    stage = 'extraction';
    timings.start('extraction');
    const extraction = document.extract(ocrResult, features);
    let data = mergeWithGenerics(extraction.data, ocrResult, features);
    timings.end('extraction');
    logStage({
      durationMs: timings.toJSON().extraction,
      extractionConfidence: extraction.extractionConfidence,
      extractionIssues: extraction.extractionIssues,
    });

    let validationResult = { passed: true, checks: {}, reason: null };
    let decision = null;
    let aggregation = {
      fraudIndicators: [],
      qualityWarnings: [],
      categoryScores: {},
      checks: {},
    };
    let detectorResults = [];

    if (document.mode === 'verification') {
      stage = 'validation';
      timings.start('validation');
      validationResult = document.validate(extraction.data);
      data = document.normalizeData(data, validationResult);
      timings.end('validation');
      logStage({
        durationMs: timings.toJSON().validation,
        validationPassed: validationResult.passed,
      });

      stage = 'authenticity';
      timings.start('authenticity');
      const ctx = {
        features,
        documentType: document.type,
        validationResult,
        extractionConfidence: extraction.extractionConfidence,
        data,
      };
      const detectorNames = [...new Set(document.authenticityChecks())];
      detectorResults = await runRuleEngine(ctx, detectorNames);
      aggregation = aggregateScores(detectorResults);
      decision = buildDecision(validationResult, aggregation);
      timings.end('authenticity');
      logStage({
        durationMs: timings.toJSON().authenticity,
        authenticityScore: aggregation.authenticityScore,
        authenticityPassed: decision.authenticity?.passed,
        overallPassed: decision.overallPassed,
      });
    }

    stage = 'complete';
    const response = buildCompletedResponse({
      document,
      decision,
      ocrConfidence: ocrResult.ocrConfidence,
      extractionConfidence: extraction.extractionConfidence,
      extractionIssues: extraction.extractionIssues,
      fraudIndicators: aggregation.fraudIndicators,
      qualityWarnings: [
        ...(ocrQuality.warnings || []),
        ...(aggregation.qualityWarnings || []),
      ],
      detectorResults,
      categoryScores: aggregation.categoryScores,
      checks: aggregation.checks,
      data,
      fullOcrText: ocrResult.text || '',
      imageQuality,
      orientationAngle: processedPages[0].orientationAngle,
      timings: timings.toJSON(),
      classification,
    });

    logStage({
      status: 'completed',
      ocrConfidence: response.ocrConfidence,
      classificationConfidence: response.classificationConfidence,
      extractionConfidence: response.extractionConfidence,
      validationPassed: response.validation?.passed,
      authenticityScore: response.authenticity?.score,
      overallPassed: response.overallPassed,
      totalMs: timings.toJSON().total,
    });

    return response;
  } catch (err) {
    logger.error({ requestId, stage, err: err.message }, 'Pipeline failed');
    throw err;
  } finally {
    if (tempDir) await removeDir(tempDir);
  }
}

async function verifyDocument(filePath, filename, requestId, documentTypeOrSlug) {
  return processDocument(filePath, filename, requestId, documentTypeOrSlug);
}

module.exports = { processDocument, verifyDocument };

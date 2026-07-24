const Timings = require('../utils/timings');
const logger = require('../logger');
const { removeDir } = require('../utils/fileCleanup');
const { buildStageLog } = require('../utils/safeLog');
const { getDocumentByType, getDocumentBySlug } = require('../documents/registry');
const { buildStoppedResponse, buildCompletedResponse } = require('./responseBuilder');
const {
  stagePreparePages,
  stagePreprocess,
  stageOcr,
  stageRetryOrientationIfNeeded,
  stageOcrQuality,
  stageClassify,
  stageExtract,
  stageValidate,
  stageRiskAssess,
} = require('./stages');
const config = require('../config');

/**
 * Gated document pipeline (standardized):
 * prepare → preprocess → OCR → quality gate → classify → extract
 * → validate (if supported) → risk (verification) → response
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
    logger.info(
      buildStageLog({
        requestId,
        filename,
        documentType: document.type,
        stage,
        ...extra,
      })
    );
  };

  try {
    // --- PreparePages ---
    stage = 'preprocess';
    timings.start('preprocess');
    const { images, tempDir: workDir, source } = await stagePreparePages(filePath, requestId);
    tempDir = workDir;

    const { processedPages: pages0, imageQuality: iq0 } = await stagePreprocess(images, {
      source,
      documentType: document.type,
      maxVariants: 1,
    });
    let processedPages = pages0;
    let imageQuality = iq0;
    timings.end('preprocess');
    logStage({ durationMs: timings.toJSON().preprocess, source, status: 'ok' });

    // --- OCR (+ optional orientation retry) ---
    stage = 'ocr';
    timings.start('ocr');
    let ocrResult = await stageOcr(processedPages);

    const retried = await stageRetryOrientationIfNeeded(
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

    // --- OCR Quality Gate ---
    const ocrQuality = stageOcrQuality(ocrResult, imageQuality);
    logStage({
      durationMs: timings.toJSON().ocr,
      ocrConfidence: ocrQuality.ocrConfidence,
      status: ocrQuality.passed ? 'ok' : 'stopped',
      stopReason: ocrQuality.passed ? undefined : 'OCR quality below configured threshold',
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
        mode: document.mode,
      });
      logStage({ stopReason: stopped.stopReason, status: 'stopped' });
      return stopped;
    }

    // Optional document-specific OCR refine (e.g. passport ROIs)
    if (typeof document.refineOcr === 'function') {
      timings.start('refineOcr');
      try {
        ocrResult = await document.refineOcr(ocrResult, processedPages[0]);
      } catch (err) {
        logger.warn({ requestId, err: err.message }, 'refineOcr failed; continuing with base OCR');
      }
      timings.end('refineOcr');
    }

    // --- Classification ---
    stage = 'classification';
    timings.start('classification');
    const { features, classification } = await stageClassify(
      document,
      processedPages,
      ocrResult,
      imageQuality
    );
    timings.end('classification');

    logStage({
      durationMs: timings.toJSON().classification,
      classificationConfidence: classification.classificationConfidence,
      status: classification.passed ? 'ok' : 'stopped',
      stopReason: classification.passed ? undefined : 'Classification confidence below threshold',
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
        mode: document.mode,
      });
      logStage({ stopReason: stopped.stopReason, status: 'stopped' });
      return stopped;
    }

    // --- Extraction ---
    stage = 'extraction';
    timings.start('extraction');
    const extraction = stageExtract(document, ocrResult, features);
    let data = extraction.data;
    timings.end('extraction');
    logStage({
      durationMs: timings.toJSON().extraction,
      extractionConfidence: extraction.extractionConfidence,
      status: 'ok',
    });

    // --- Validation (if supported) ---
    let validationResult = { passed: true, checks: {}, reasons: [], reason: null };
    if (document.supportsValidation) {
      stage = 'validation';
      timings.start('validation');
      validationResult = stageValidate(document, extraction.data);
      data = document.normalizeData(data, validationResult);
      timings.end('validation');
      logStage({
        durationMs: timings.toJSON().validation,
        validationPassed: validationResult.passed,
        status: 'ok',
      });
    }

    // --- Risk assessment (verification only) ---
    let decision = null;
    let aggregation = {
      fraudIndicators: [],
      qualityWarnings: [],
      categoryScores: {},
      checks: {},
      reasoning: [],
    };
    let detectorResults = [];

    if (document.mode === 'verification') {
      stage = 'risk';
      timings.start('risk');
      const risk = await stageRiskAssess(document, {
        features,
        documentType: document.type,
        validationResult,
        extractionConfidence: extraction.extractionConfidence,
        data,
      });
      detectorResults = risk.detectorResults;
      aggregation = risk.aggregation;
      decision = risk.decision;
      timings.end('risk');
      logStage({
        durationMs: timings.toJSON().risk,
        riskScore: aggregation.riskScore,
        riskPassed: decision?.riskAssessment?.passed ?? decision?.authenticity?.passed,
        validationPassed: validationResult.passed,
        status: 'ok',
      });
    }

    // --- Response ---
    stage = 'complete';
    const qualityWarnings = [
      ...(ocrQuality.warnings || []),
      ...(aggregation.qualityWarnings || []),
    ];
    if (extraction.extractionBelowThreshold) {
      qualityWarnings.push(
        `Extraction confidence ${extraction.extractionConfidence}% below threshold ${config.extractionThreshold}%`
      );
    }

    const response = buildCompletedResponse({
      document,
      decision,
      aggregation,
      ocrConfidence: ocrResult.ocrConfidence,
      extractionConfidence: extraction.extractionConfidence,
      extractionReasons: extraction.extractionReasons,
      extractionIssues: extraction.extractionIssues,
      extractionBelowThreshold: extraction.extractionBelowThreshold,
      fraudIndicators: aggregation.fraudIndicators,
      qualityWarnings,
      detectorResults,
      categoryScores: aggregation.categoryScores,
      checks: aggregation.checks,
      data,
      fullOcrText: ocrResult.text || '',
      imageQuality,
      orientationAngle: processedPages[0].orientationAngle,
      timings: timings.toJSON(),
      classification,
      validationResult: document.supportsValidation ? validationResult : null,
    });

    logStage({
      status: 'completed',
      ocrConfidence: response.ocrConfidence,
      classificationConfidence: response.classificationConfidence,
      extractionConfidence: response.extractionConfidence,
      validationPassed: response.validation?.passed,
      riskScore: response.riskAssessment?.overallScore ?? response.authenticity?.score,
      riskPassed: response.riskAssessment?.passed ?? response.authenticity?.passed,
      overallPassed: response.overallPassed,
      totalMs: timings.toJSON().total,
    });

    return response;
  } catch (err) {
    logger.error(
      buildStageLog({ requestId, documentType: document.type, stage, status: 'error' }),
      err.message
    );
    throw err;
  } finally {
    if (tempDir) await removeDir(tempDir);
  }
}

async function verifyDocument(filePath, filename, requestId, documentTypeOrSlug) {
  return processDocument(filePath, filename, requestId, documentTypeOrSlug);
}

module.exports = { processDocument, verifyDocument };

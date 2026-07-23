const fs = require('fs/promises');
const config = require('../config');
const Timings = require('../utils/timings');
const { removeDir } = require('../utils/fileCleanup');
const { prepareImages } = require('../preprocessing/pdf');
const { analyzeImageQuality } = require('../preprocessing/quality');
const { preprocessChain } = require('../preprocessing/chain');
const { runOcrOnPages } = require('../ocr/tesseract');
const { extractFeatures } = require('../features/extractFeatures');
const { identifyDocument } = require('../documents/registry');
const { runRuleEngine } = require('../rules/engine');
const { aggregateScores, buildDecision } = require('../rules/aggregator');

async function verifyDocument(filePath, filename, requestId) {
  const timings = new Timings();
  let tempDir = null;

  try {
    timings.start('preprocess');
    const { images, tempDir: workDir } = await prepareImages(filePath, requestId);
    tempDir = workDir;

    const processedPages = [];
    for (const img of images) {
      processedPages.push(await preprocessChain(img));
    }

    // Quality on oriented/processed card image (not dark desk background)
    const imageQuality = await analyzeImageQuality(processedPages[0].processedBuffer);
    timings.end('preprocess');

    timings.start('ocr');
    const ocrBuffers = processedPages.map((p) => p.ocrBuffer);
    const ocrVariantsList = processedPages.map((p) => p.ocrVariants || [p.ocrBuffer]);
    const ocrResult = await runOcrOnPages(ocrBuffers, ocrVariantsList);
    timings.end('ocr');

    timings.start('classification');
    const features = await extractFeatures(
      processedPages[0].processedBuffer,
      ocrResult,
      imageQuality
    );

    const identification = identifyDocument(features, ocrResult);
    timings.end('classification');

    if (!identification.document) {
      return {
        documentType: 'UNKNOWN',
        validation: { passed: false, checks: {}, reason: 'Unknown document type' },
        authenticity: { passed: false, score: 0, threshold: config.authScoreThreshold },
        overallPassed: false,
        ocrConfidence: ocrResult.ocrConfidence,
        extractionConfidence: 0,
        extractionIssues: ['Document could not be classified'],
        fraudIndicators: ['Unknown document type'],
        detectorResults: [],
        categoryScores: {},
        data: {},
        imageQuality,
        rejectionReasons: ['Document type not recognized as Aadhaar or PAN'],
        timings: timings.toJSON(),
      };
    }

    const document = identification.document;

    timings.start('validation');
    const extraction = document.extract(ocrResult);
    const validationResult = document.validate(extraction.data);
    timings.end('validation');

    timings.start('authenticity');
    const ctx = {
      features,
      documentType: identification.type,
      validationResult,
      extractionConfidence: extraction.extractionConfidence,
      data: extraction.data,
    };

    const detectorNames = [...document.authenticityChecks(), 'ocrQualityDetector'];

    const detectorResults = await runRuleEngine(ctx, detectorNames);
    const aggregation = aggregateScores(detectorResults);
    const decision = buildDecision(validationResult, aggregation);
    timings.end('authenticity');

    if (validationResult.normalized) {
      if (identification.type === 'AADHAAR') extraction.data.aadhaar = validationResult.normalized;
      if (identification.type === 'PAN') extraction.data.pan = validationResult.normalized;
    }

    return {
      documentType: identification.type,
      ...decision,
      ocrConfidence: ocrResult.ocrConfidence,
      extractionConfidence: extraction.extractionConfidence,
      extractionIssues: extraction.extractionIssues,
      fraudIndicators: aggregation.fraudIndicators,
      qualityWarnings: aggregation.qualityWarnings || [],
      detectorResults,
      categoryScores: aggregation.categoryScores,
      checks: aggregation.checks,
      data: extraction.data,
      imageQuality,
      identificationScore: identification.score,
      orientationAngle: processedPages[0].orientationAngle,
      timings: timings.toJSON(),
    };
  } finally {
    if (tempDir) await removeDir(tempDir);
  }
}

module.exports = { verifyDocument };

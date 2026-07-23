const { processDocument } = require('../pipeline/orchestrator');
const { listDocumentTypes, getDocumentBySlug } = require('../documents/registry');
const { removeFile } = require('../utils/fileCleanup');
const logger = require('../logger');

async function listTypes(_req, res) {
  res.json({ documents: listDocumentTypes() });
}

async function processBySlug(req, res, next) {
  const startTime = Date.now();
  const file = req.file;
  const slug = req.params.slug;

  if (!getDocumentBySlug(slug)) {
    return res.status(404).json({
      error: `Unknown document endpoint "/api/${slug}".`,
      documents: listDocumentTypes(),
    });
  }

  if (!file) {
    return res.status(400).json({ error: 'No document uploaded. Use field name "document".' });
  }

  try {
    const result = await processDocument(file.path, file.originalname, req.requestId, slug);

    logger.info({
      requestId: req.requestId,
      processingTime: Date.now() - startTime,
      filename: file.originalname,
      endpoint: `/api/${slug}`,
      stage: result.stage,
      status: result.status,
      stopReason: result.status === 'stopped' ? result.reason : null,
      documentType: result.documentType,
      mode: result.mode,
      ocrConfidence: result.ocrConfidence,
      classificationConfidence: result.classificationConfidence,
      extractionConfidence: result.extractionConfidence,
      validationPassed: result.validation?.passed ?? null,
      authenticityScore: result.authenticity?.score ?? null,
      authenticityPassed: result.authenticity?.passed ?? null,
      overallPassed: result.overallPassed,
      fraudIndicators: result.fraudIndicators,
      timings: result.timings,
    });

    res.json(result);
  } catch (err) {
    next(err);
  } finally {
    await removeFile(file.path);
  }
}

module.exports = { listTypes, processBySlug };

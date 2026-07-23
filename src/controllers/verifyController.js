const { verifyDocument } = require('../pipeline/orchestrator');
const { removeFile } = require('../utils/fileCleanup');
const logger = require('../logger');

async function verify(req, res, next) {
  const startTime = Date.now();
  const file = req.file;

  if (!file) {
    return res.status(400).json({ error: 'No document uploaded. Use field name "document".' });
  }

  try {
    const result = await verifyDocument(file.path, file.originalname, req.requestId);

    logger.info({
      requestId: req.requestId,
      processingTime: Date.now() - startTime,
      filename: file.originalname,
      documentType: result.documentType,
      authenticityScore: result.authenticity?.score,
      validationPassed: result.validation?.passed,
      authenticityPassed: result.authenticity?.passed,
      fraudIndicators: result.fraudIndicators,
      rejectionReasons: result.rejectionReasons,
    });

    res.json(result);
  } catch (err) {
    next(err);
  } finally {
    await removeFile(file.path);
  }
}

module.exports = { verify };

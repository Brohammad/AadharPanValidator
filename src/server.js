const fs = require('fs');
const app = require('./app');
const config = require('./config');
const logger = require('./logger');
const { runOcrOnce, terminateOcr } = require('./ocr/tesseract');

[config.uploadDir, config.tempDir].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const server = app.listen(config.port, async () => {
  logger.info(`Document verification server running on http://localhost:${config.port}`);
  // Warm OCR workers so first request is not cold-start heavy
  try {
    const sharp = require('sharp');
    const probe = await sharp({
      create: { width: 64, height: 32, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .png()
      .toBuffer();
    await runOcrOnce(probe, { tessedit_pageseg_mode: '6' });
    logger.info('OCR workers warmed up');
  } catch (err) {
    logger.warn({ err: err.message }, 'OCR warmup skipped');
  }
});

async function shutdown() {
  server.close();
  await terminateOcr();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

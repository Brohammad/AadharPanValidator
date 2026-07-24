const sharp = require('sharp');
const config = require('../../config');

async function resizeForOcr(buffer, targetWidth) {
  const widthTarget = targetWidth ?? config.ocrResizeWidthPdf;
  const meta = await sharp(buffer).metadata();
  const width = meta.width || 0;
  if (width >= widthTarget && width <= 2200) return buffer;
  return sharp(buffer)
    .resize({
      width: widthTarget,
      kernel: sharp.kernel.lanczos3,
      withoutEnlargement: false,
    })
    .toBuffer();
}

module.exports = { resizeForOcr };

/**
 * Poppler access via node-poppler.
 * - Windows: uses bundled binaries from optional dep node-poppler-win32
 * - macOS/Linux: uses system Poppler on PATH (brew / apt)
 */
const { Poppler } = require('node-poppler');

let cached = null;

function getPoppler() {
  if (cached) return cached;
  try {
    cached = new Poppler();
    return cached;
  } catch (err) {
    const hint =
      process.platform === 'win32'
        ? 'Re-run npm install (node-poppler-win32 should install automatically on Windows).'
        : 'Install Poppler: brew install poppler  (macOS) or  sudo apt install poppler-utils  (Linux)';
    const missing = new Error(
      `PDF conversion requires Poppler binaries. ${hint} (${err.message})`
    );
    missing.status = 500;
    throw missing;
  }
}

/**
 * Extract embedded images from a PDF (pdfimages -png).
 * @returns {Promise<void>}
 */
async function pdfImagesPng(filePath, outputPrefix) {
  const poppler = getPoppler();
  await poppler.pdfImages(filePath, outputPrefix, { pngFile: true });
}

/**
 * Rasterize PDF pages to PNG (pdftoppm -png -r dpi).
 * @returns {Promise<void>}
 */
async function pdfToPng(filePath, outputPrefix, dpi = 200) {
  const poppler = getPoppler();
  await poppler.pdfToPpm(filePath, outputPrefix, {
    pngFile: true,
    resolutionXYAxis: dpi,
  });
}

module.exports = {
  getPoppler,
  pdfImagesPng,
  pdfToPng,
};

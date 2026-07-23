const fs = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const sharp = require('sharp');
const { PDFDocument } = require('pdf-lib');
const config = require('../config');

const execFileAsync = promisify(execFile);

async function checkPdfEncryption(filePath) {
  const bytes = await fs.readFile(filePath);
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return pdfDoc.isEncrypted;
}

async function getPageCount(filePath) {
  const bytes = await fs.readFile(filePath);
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return pdfDoc.getPageCount();
}

/**
 * Prefer extracting the original embedded photo/scan from the PDF.
 * When someone saves a PAN/Aadhaar image as PDF, this recovers the same pixels
 * the image upload path would see — far better than re-rasterizing an A4 page.
 */
async function extractEmbeddedImages(filePath, outputDir) {
  await fs.mkdir(outputDir, { recursive: true });
  const prefix = path.join(outputDir, 'embed');

  try {
    await execFileAsync('pdfimages', ['-png', filePath, prefix], {
      timeout: 60000,
      maxBuffer: 40 * 1024 * 1024,
    });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    return [];
  }

  const entries = await fs.readdir(outputDir);
  const files = entries
    .filter((f) => /^embed[-_]?\d+\.png$/i.test(f))
    .map((f) => path.join(outputDir, f));

  const usable = [];
  for (const file of files) {
    try {
      const meta = await sharp(file).metadata();
      const w = meta.width || 0;
      const h = meta.height || 0;
      // Skip icons / logos / stamps; keep card-sized embeds
      if (w >= 400 && h >= 250) {
        usable.push({ file, area: w * h, w, h });
      }
    } catch {
      // ignore unreadable
    }
  }

  usable.sort((a, b) => b.area - a.area);
  return usable.map((u) => u.file);
}

/**
 * Fallback: rasterize PDF pages with Poppler.
 */
async function rasterizePdfPages(filePath, outputDir) {
  await fs.mkdir(outputDir, { recursive: true });
  const prefix = path.join(outputDir, 'page');

  try {
    // 200 DPI is enough for ID cards and much faster than 300 on full A4
    await execFileAsync(
      'pdftoppm',
      ['-png', '-r', '200', filePath, prefix],
      { timeout: 120000, maxBuffer: 40 * 1024 * 1024 }
    );
  } catch (err) {
    if (err.code === 'ENOENT') {
      const missing = new Error(
        'PDF conversion requires Poppler (pdftoppm). Install with: brew install poppler  (macOS) or  sudo apt install poppler-utils  (Linux)'
      );
      missing.status = 500;
      throw missing;
    }
    const failed = new Error(`PDF conversion failed: ${err.stderr || err.message}`);
    failed.status = 422;
    throw failed;
  }

  const entries = await fs.readdir(outputDir);
  return entries
    .filter((f) => /^page-\d+\.png$/i.test(f) || /^page\d+\.png$/i.test(f))
    .sort((a, b) => {
      const na = parseInt(a.replace(/\D/g, ''), 10) || 0;
      const nb = parseInt(b.replace(/\D/g, ''), 10) || 0;
      return na - nb;
    })
    .map((f) => path.join(outputDir, f));
}

async function convertPdfToImages(filePath, outputDir) {
  await fs.mkdir(outputDir, { recursive: true });

  const embedded = await extractEmbeddedImages(filePath, outputDir);
  if (embedded.length > 0) {
    return { images: embedded, renderMode: 'embedded' };
  }

  const pages = await rasterizePdfPages(filePath, outputDir);
  return { images: pages, renderMode: 'raster' };
}

async function prepareImages(filePath, requestId) {
  const ext = path.extname(filePath).toLowerCase();
  const tempDir = path.join(config.tempDir, requestId);
  await fs.mkdir(tempDir, { recursive: true });

  if (ext === '.pdf') {
    const encrypted = await checkPdfEncryption(filePath);
    if (encrypted) {
      const err = new Error('Password-protected or encrypted PDFs are not supported');
      err.status = 422;
      throw err;
    }
    const { images, renderMode } = await convertPdfToImages(filePath, tempDir);
    if (images.length === 0) {
      const err = new Error('Failed to convert PDF pages to images');
      err.status = 422;
      throw err;
    }
    // Embedded scans behave like images for orientation, but use the fast path
    const source = renderMode === 'embedded' ? 'embedded' : 'pdf';
    return { images, tempDir, source, renderMode };
  }

  const dest = path.join(tempDir, path.basename(filePath));
  await fs.copyFile(filePath, dest);
  return { images: [dest], tempDir, source: 'image', renderMode: 'file' };
}

module.exports = {
  checkPdfEncryption,
  convertPdfToImages,
  prepareImages,
  getPageCount,
  extractEmbeddedImages,
};

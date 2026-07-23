const fs = require('fs/promises');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const { fromPath } = require('pdf2pic');
const config = require('../config');

async function checkPdfEncryption(filePath) {
  const bytes = await fs.readFile(filePath);
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return pdfDoc.isEncrypted;
}

async function convertPdfToImages(filePath, outputDir) {
  await fs.mkdir(outputDir, { recursive: true });
  const converter = fromPath(filePath, {
    density: 200,
    saveFilename: 'page',
    savePath: outputDir,
    format: 'png',
    width: 2000,
    height: 2000,
  });

  const pageCount = await getPageCount(filePath);
  const images = [];

  for (let page = 1; page <= pageCount; page++) {
    const result = await converter(page, { responseType: 'image' });
    if (result.path) {
      images.push(result.path);
    }
  }

  return images;
}

async function getPageCount(filePath) {
  const bytes = await fs.readFile(filePath);
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return pdfDoc.getPageCount();
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
    const images = await convertPdfToImages(filePath, tempDir);
    if (images.length === 0) {
      const err = new Error('Failed to convert PDF pages to images');
      err.status = 422;
      throw err;
    }
    return { images, tempDir };
  }

  const dest = path.join(tempDir, path.basename(filePath));
  await fs.copyFile(filePath, dest);
  return { images: [dest], tempDir };
}

module.exports = { checkPdfEncryption, convertPdfToImages, prepareImages };

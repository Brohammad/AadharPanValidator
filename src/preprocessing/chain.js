const sharp = require('sharp');
const fs = require('fs/promises');
const config = require('../config');
const {
  autoRotateExif,
  correctCardOrientation,
  correctEmbeddedOrientation,
  cropCardRegion,
  resizeForOcr,
  toOcrVariantsPhoto,
  toOcrVariantsPdf,
  toPanInvertVariant,
  PROFILES,
} = require('./stages');

/**
 * Rotate an already-processed page set to a new absolute angle from the
 * original buffer (used by OCR orientation retry).
 */
async function rebuildPageAtAngle(originalBuffer, angle, { source = 'embedded', documentType, maxVariants = 1 } = {}) {
  let buffer =
    angle === 0 ? originalBuffer : await sharp(originalBuffer).rotate(angle).toBuffer();
  const targetWidth =
    source === 'image' ? config.ocrResizeWidthPhoto : config.ocrResizeWidthPdf;
  buffer = await resizeForOcr(buffer, targetWidth);

  let ocrVariants =
    source === 'image'
      ? await toOcrVariantsPhoto(buffer, { fast: true, maxVariants })
      : await toOcrVariantsPdf(buffer, { maxVariants });

  if (documentType === 'PAN' && source !== 'image') {
    ocrVariants = [await toPanInvertVariant(buffer)];
  }

  const processedBuffer = await sharp(buffer).normalize().sharpen({ sigma: 0.7 }).toBuffer();
  return {
    originalBuffer,
    processedBuffer,
    ocrBuffer: ocrVariants[0],
    ocrVariants,
    orientationAngle: angle,
    source,
    profile: source === 'image' ? 'photo' : source === 'pdf' ? 'pdf_scan' : 'embedded',
  };
}

/**
 * Unified preprocess chain. Source only selects a stage profile;
 * after this, all pages share the same shape.
 *
 * @param {string} imagePath
 * @param {{ source?: 'pdf' | 'image' | 'embedded', documentType?: string, maxVariants?: number, skipOrientationOcr?: boolean }} [options]
 */
async function preprocessChain(imagePath, options = {}) {
  const source = options.source || 'image';
  const maxVariants = options.maxVariants != null ? options.maxVariants : source === 'image' ? 2 : 1;
  const profile =
    source === 'pdf' ? 'pdf_scan' : source === 'embedded' ? 'embedded' : 'photo';

  let buffer = await fs.readFile(imagePath);
  const originalBuffer = buffer;

  buffer = await autoRotateExif(buffer);

  let orientationAngle = 0;

  if (profile === 'pdf_scan') {
    buffer = await cropCardRegion(buffer);
    buffer = await resizeForOcr(buffer, config.ocrResizeWidthPdf);
    const ocrVariants = await toOcrVariantsPdf(buffer, { maxVariants });
    const processedBuffer = await sharp(buffer)
      .resize({ width: config.ocrResizeWidthPdf, withoutEnlargement: true })
      .normalize()
      .sharpen({ sigma: 0.6 })
      .toBuffer();

    return {
      originalBuffer,
      processedBuffer,
      ocrBuffer: ocrVariants[0],
      ocrVariants,
      orientationAngle: 0,
      source: 'pdf',
      profile,
      stagesApplied: PROFILES.pdf_scan,
    };
  }

  if (profile === 'embedded') {
    const oriented = await correctEmbeddedOrientation(buffer);
    buffer = oriented.buffer;
    orientationAngle = oriented.angle;
    buffer = await resizeForOcr(buffer, config.ocrResizeWidthPdf);
    let ocrVariants = await toOcrVariantsPdf(buffer, { maxVariants });

    if (options.documentType === 'PAN') {
      ocrVariants = [await toPanInvertVariant(buffer)];
    }

    const processedBuffer = await sharp(buffer).normalize().sharpen({ sigma: 0.7 }).toBuffer();

    return {
      originalBuffer,
      processedBuffer,
      ocrBuffer: ocrVariants[0],
      ocrVariants,
      orientationAngle,
      source: 'embedded',
      profile,
      stagesApplied: PROFILES.embedded,
    };
  }

  // photo profile
  buffer = await cropCardRegion(buffer);

  // Skip expensive OCR orientation probes when caller already knows upright
  if (!options.skipOrientationOcr) {
    const oriented = await correctCardOrientation(buffer);
    buffer = oriented.buffer;
    orientationAngle = oriented.angle;
  }

  buffer = await resizeForOcr(buffer, config.ocrResizeWidthPhoto);
  const ocrVariants = await toOcrVariantsPhoto(buffer, {
    fast: true,
    maxVariants,
  });
  const processedBuffer = await sharp(buffer).normalize().sharpen().toBuffer();

  return {
    originalBuffer,
    processedBuffer,
    ocrBuffer: ocrVariants[0],
    ocrVariants,
    orientationAngle,
    source: 'image',
    profile,
    stagesApplied: PROFILES.photo,
  };
}

module.exports = {
  preprocessChain,
  autoRotateExif,
  resizeForOcr,
  toOcrVariantsPhoto,
  toOcrVariantsPdf,
  toOcrVariants: toOcrVariantsPhoto,
  correctCardOrientation,
  correctEmbeddedOrientation,
  rebuildPageAtAngle,
  cropCardRegion,
  PROFILES,
};

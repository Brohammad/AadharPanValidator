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
  toPanOcrVariants,
  PROFILES,
} = require('./stages');

/** Aadhaar/PAN photo-in-PDF embeds need phone-photo OCR variants, not flat greyscale. */
function isIdCardType(documentType) {
  return documentType === 'AADHAAR' || documentType === 'PAN';
}

async function buildOcrVariants(buffer, { source, documentType, maxVariants = 2 } = {}) {
  if (documentType === 'PAN') {
    return toPanOcrVariants(buffer, { maxVariants: Math.max(maxVariants, 3) });
  }
  if (source === 'image' || isIdCardType(documentType)) {
    return toOcrVariantsPhoto(buffer, {
      fast: true,
      maxVariants: Math.max(maxVariants, 2),
    });
  }
  return toOcrVariantsPdf(buffer, { maxVariants });
}

/**
 * Rotate an already-processed page set to a new absolute angle from the
 * original buffer (used by OCR orientation retry).
 */
async function rebuildPageAtAngle(originalBuffer, angle, { source = 'embedded', documentType, maxVariants = 2 } = {}) {
  let buffer =
    angle === 0 ? originalBuffer : await sharp(originalBuffer).rotate(angle).toBuffer();
  const targetWidth =
    source === 'image' || isIdCardType(documentType)
      ? config.ocrResizeWidthPhoto
      : config.ocrResizeWidthPdf;
  buffer = await resizeForOcr(buffer, targetWidth);

  const ocrVariants = await buildOcrVariants(buffer, {
    source,
    documentType,
    maxVariants,
  });

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
 */
async function preprocessChain(imagePath, options = {}) {
  const source = options.source || 'image';
  const documentType = options.documentType;
  const idCard = isIdCardType(documentType);
  const maxVariants =
    options.maxVariants != null
      ? options.maxVariants
      : source === 'image' || idCard
        ? 2
        : 1;
  const profile =
    source === 'pdf' ? 'pdf_scan' : source === 'embedded' ? 'embedded' : 'photo';

  let buffer = await fs.readFile(imagePath);
  const originalBuffer = buffer;

  buffer = await autoRotateExif(buffer);

  let orientationAngle = 0;

  if (profile === 'pdf_scan') {
    buffer = await cropCardRegion(buffer);
    buffer = await resizeForOcr(
      buffer,
      idCard ? config.ocrResizeWidthPhoto : config.ocrResizeWidthPdf
    );
    const ocrVariants = await buildOcrVariants(buffer, {
      source: idCard ? 'image' : 'pdf',
      documentType,
      maxVariants,
    });
    const processedBuffer = await sharp(buffer)
      .resize({
        width: idCard ? config.ocrResizeWidthPhoto : config.ocrResizeWidthPdf,
        withoutEnlargement: true,
      })
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
    // Photo-in-PDF ID cards are often sideways in a portrait frame.
    // Edge heuristics mis-pick 0°/270° — use OCR orientation probe for Aadhaar/PAN.
    if (idCard) {
      const oriented = await correctCardOrientation(buffer);
      buffer = oriented.buffer;
      orientationAngle = oriented.angle;
    } else {
      const oriented = await correctEmbeddedOrientation(buffer);
      buffer = oriented.buffer;
      orientationAngle = oriented.angle;
    }

    buffer = await resizeForOcr(
      buffer,
      idCard ? config.ocrResizeWidthPhoto : config.ocrResizeWidthPdf
    );
    const ocrVariants = await buildOcrVariants(buffer, {
      source: 'embedded',
      documentType,
      maxVariants,
    });

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

  if (!options.skipOrientationOcr) {
    const oriented = await correctCardOrientation(buffer);
    buffer = oriented.buffer;
    orientationAngle = oriented.angle;
  }

  buffer = await resizeForOcr(buffer, config.ocrResizeWidthPhoto);
  const ocrVariants = await buildOcrVariants(buffer, {
    source: 'image',
    documentType,
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
  buildOcrVariants,
  isIdCardType,
  PROFILES,
};

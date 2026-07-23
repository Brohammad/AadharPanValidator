const sharp = require('sharp');
const fs = require('fs/promises');
const { runOcrOnce, scoreOcrResult } = require('../ocr/tesseract');

async function autoRotateExif(buffer) {
  return sharp(buffer).rotate().toBuffer();
}

/**
 * Crop to the main card content, trimming dark desk / scanner margins.
 * Skipped for already-tight embeds (fast path).
 */
async function cropCardRegion(buffer) {
  const meta = await sharp(buffer).metadata();
  const width = meta.width || 0;
  const height = meta.height || 0;
  if (width < 100 || height < 100) return buffer;

  const { data, info } = await sharp(buffer)
    .greyscale()
    .resize({ width: 600, withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  let found = false;

  for (let y = 1; y < h - 1; y += 2) {
    for (let x = 1; x < w - 1; x += 2) {
      const v = data[y * w + x];
      if (v <= 35 || v >= 250) continue;
      const diff = Math.abs(v - data[y * w + x - 1]) + Math.abs(v - data[(y - 1) * w + x]);
      if (diff < 12) continue;
      found = true;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (!found) return buffer;

  const contentW = (maxX - minX) / w;
  const contentH = (maxY - minY) / h;
  if (contentW > 0.92 && contentH > 0.92) return buffer;
  if (contentW < 0.25 || contentH < 0.25) return buffer;

  const pad = 0.03;
  const left = Math.max(0, Math.floor((minX / w - pad) * width));
  const top = Math.max(0, Math.floor((minY / h - pad) * height));
  const cropW = Math.min(width - left, Math.ceil(((maxX - minX) / w + 2 * pad) * width));
  const cropH = Math.min(height - top, Math.ceil(((maxY - minY) / h + 2 * pad) * height));

  if (cropW < 80 || cropH < 80) return buffer;

  return sharp(buffer)
    .extract({ left, top, width: cropW, height: cropH })
    .toBuffer();
}

async function resizeForOcr(buffer, targetWidth = 1600) {
  const meta = await sharp(buffer).metadata();
  const width = meta.width || 0;
  if (width >= targetWidth && width <= 2200) return buffer;
  const widthTarget = width > 2200 ? targetWidth : targetWidth;
  return sharp(buffer)
    .resize({
      width: widthTarget,
      kernel: sharp.kernel.lanczos3,
      withoutEnlargement: false,
    })
    .toBuffer();
}

/**
 * OCR variants for phone photos of physical cards (invert helps blue PAN).
 * Fast path keeps this to 2 variants.
 */
async function toOcrVariantsPhoto(buffer, { fast = false } = {}) {
  const simple = await sharp(buffer).greyscale().normalize().sharpen({ sigma: 1.0 }).png().toBuffer();
  if (fast) {
    const inverted = await sharp(buffer)
      .modulate({ brightness: 1.25, saturation: 0.2 })
      .greyscale()
      .negate()
      .normalize()
      .sharpen()
      .png()
      .toBuffer();
    return [inverted, simple];
  }

  const [inverted, highContrast, blueNeg] = await Promise.all([
    sharp(buffer)
      .modulate({ brightness: 1.3, saturation: 0.2 })
      .greyscale()
      .negate()
      .normalize()
      .sharpen()
      .png()
      .toBuffer(),
    sharp(buffer).greyscale().linear(1.7, -70).normalize().sharpen().png().toBuffer(),
    sharp(buffer).extractChannel(2).normalize().negate().normalize().sharpen().png().toBuffer(),
  ]);

  return [inverted, simple, blueNeg, highContrast];
}

/** Single greyscale variant for PDF / embedded (speed). */
async function toOcrVariantsPdf(buffer) {
  const sized = await sharp(buffer)
    .resize({ width: 1600, withoutEnlargement: true, kernel: sharp.kernel.lanczos3 })
    .greyscale()
    .normalize()
    .sharpen({ sigma: 0.8 })
    .png()
    .toBuffer();
  return [sized];
}

/**
 * Probe orientations with invert (phone photos) — max 2 angles, small probe.
 */
async function correctCardOrientation(buffer) {
  const angles = [0, 270, 90];
  let bestBuffer = buffer;
  let bestScore = -Infinity;
  let bestAngle = 0;

  for (const angle of angles) {
    const rotated =
      angle === 0 ? buffer : await sharp(buffer).rotate(angle).toBuffer();

    const probe = await sharp(rotated)
      .resize({ width: 900, withoutEnlargement: true })
      .modulate({ brightness: 1.25, saturation: 0.2 })
      .greyscale()
      .negate()
      .normalize()
      .png()
      .toBuffer();

    const result = await runOcrOnce(probe, { tessedit_pageseg_mode: '6' });
    let score = scoreOcrResult(result);
    const upper = (result.text || '').toUpperCase();
    if (/CAMSCANNER|SCANNED\s*BY/.test(upper) && score < 80) score -= 50;

    if (score > bestScore) {
      bestScore = score;
      bestBuffer = rotated;
      bestAngle = angle;
    }
    if (score >= 90) break;
  }

  return { buffer: bestBuffer, angle: bestAngle, score: bestScore };
}

/**
 * Cheap uprightness score without full OCR — horizontal edge / text-like runs.
 * Used only as a tie-breaker hint; real orientation is confirmed by OCR retry.
 */
async function estimateUprightScore(buffer) {
  const { data, info } = await sharp(buffer)
    .greyscale()
    .resize({ width: 240, withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  let horiz = 0;
  let vert = 0;
  for (let y = 1; y < h - 1; y += 2) {
    for (let x = 1; x < w - 1; x += 2) {
      const i = y * w + x;
      const dx = Math.abs(data[i] - data[i - 1]);
      const dy = Math.abs(data[i] - data[i - w]);
      if (dx > 28) horiz++;
      if (dy > 28) vert++;
    }
  }
  return horiz - vert;
}

/**
 * Fast embedded orientation: prefer EXIF/0, optionally pick better of 0 vs 270
 * via cheap edge heuristic — NO OCR during preprocess.
 */
async function correctEmbeddedOrientation(buffer) {
  const meta = await sharp(buffer).metadata();
  const w = meta.width || 0;
  const h = meta.height || 0;

  // Landscape embeds of portrait cards are usually sideways → try 270 first
  const preferSideways = w > h * 1.15;
  const candidateAngles = preferSideways ? [270, 0, 90] : [0, 270, 90];

  let bestAngle = candidateAngles[0];
  let bestScore = -Infinity;
  let bestBuffer = preferSideways ? await sharp(buffer).rotate(bestAngle).toBuffer() : buffer;

  for (const angle of candidateAngles.slice(0, 2)) {
    const rotated =
      angle === 0
        ? buffer
        : angle === bestAngle && bestBuffer
          ? bestBuffer
          : await sharp(buffer).rotate(angle).toBuffer();
    const score = await estimateUprightScore(rotated);
    if (score > bestScore) {
      bestScore = score;
      bestAngle = angle;
      bestBuffer = rotated;
    }
  }

  return { buffer: bestBuffer, angle: bestAngle, score: bestScore };
}

/**
 * Rotate an already-processed page set to a new absolute angle from the
 * original buffer (used by OCR orientation retry).
 */
async function rebuildPageAtAngle(originalBuffer, angle, { source = 'embedded', documentType } = {}) {
  let buffer =
    angle === 0 ? originalBuffer : await sharp(originalBuffer).rotate(angle).toBuffer();
  buffer = await resizeForOcr(buffer, source === 'image' ? 1800 : 1600);
  let ocrVariants =
    source === 'image'
      ? await toOcrVariantsPhoto(buffer, { fast: true })
      : await toOcrVariantsPdf(buffer);

  if (documentType === 'PAN' && source !== 'image') {
    const inverted = await sharp(buffer)
      .resize({ width: 1600, withoutEnlargement: true })
      .greyscale()
      .negate()
      .normalize()
      .sharpen()
      .png()
      .toBuffer();
    ocrVariants = [inverted];
  }

  const processedBuffer = await sharp(buffer).normalize().sharpen({ sigma: 0.7 }).toBuffer();
  return {
    originalBuffer,
    processedBuffer,
    ocrBuffer: ocrVariants[0],
    ocrVariants,
    orientationAngle: angle,
    source,
  };
}

/**
 * @param {string} imagePath
 * @param {{ source?: 'pdf' | 'image' | 'embedded' }} [options]
 */
async function preprocessChain(imagePath, options = {}) {
  const source = options.source || 'image';
  const fromPdf = source === 'pdf';
  const fromEmbedded = source === 'embedded';
  let buffer = await fs.readFile(imagePath);
  const originalBuffer = buffer;

  buffer = await autoRotateExif(buffer);

  if (fromPdf) {
    buffer = await cropCardRegion(buffer);
    buffer = await resizeForOcr(buffer, 1600);
    const ocrVariants = await toOcrVariantsPdf(buffer);
    const processedBuffer = await sharp(buffer)
      .resize({ width: 1600, withoutEnlargement: true })
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
    };
  }

  if (fromEmbedded) {
    // No OCR during preprocess — orientation via cheap heuristic only.
    const oriented = await correctEmbeddedOrientation(buffer);
    buffer = oriented.buffer;
    buffer = await resizeForOcr(buffer, 1600);
    let ocrVariants = await toOcrVariantsPdf(buffer);

    // Blue PAN cards often need invert — use invert as the primary (only) variant.
    if (options.documentType === 'PAN') {
      const inverted = await sharp(buffer)
        .resize({ width: 1600, withoutEnlargement: true })
        .modulate({ brightness: 1.25, saturation: 0.15 })
        .greyscale()
        .negate()
        .normalize()
        .sharpen()
        .png()
        .toBuffer();
      ocrVariants = [inverted];
    }

    const processedBuffer = await sharp(buffer).normalize().sharpen({ sigma: 0.7 }).toBuffer();

    return {
      originalBuffer,
      processedBuffer,
      ocrBuffer: ocrVariants[0],
      ocrVariants,
      orientationAngle: oriented.angle,
      source: 'embedded',
    };
  }

  // Phone photos: one crop + limited orientation (still OCR-based but capped)
  buffer = await cropCardRegion(buffer);
  const oriented = await correctCardOrientation(buffer);
  buffer = oriented.buffer;
  buffer = await resizeForOcr(buffer, 1800);

  const ocrVariants = await toOcrVariantsPhoto(buffer, { fast: true });
  const processedBuffer = await sharp(buffer).normalize().sharpen().toBuffer();

  return {
    originalBuffer,
    processedBuffer,
    ocrBuffer: ocrVariants[0],
    ocrVariants,
    orientationAngle: oriented.angle,
    source: 'image',
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
};

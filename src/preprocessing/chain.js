const sharp = require('sharp');
const fs = require('fs/promises');
const { runOcrOnce, scoreOcrResult } = require('../ocr/tesseract');

async function autoRotateExif(buffer) {
  return sharp(buffer).rotate().toBuffer();
}

/**
 * Crop to the main card content, trimming dark desk / scanner margins.
 */
async function cropCardRegion(buffer) {
  const meta = await sharp(buffer).metadata();
  const width = meta.width || 0;
  const height = meta.height || 0;
  if (width < 100 || height < 100) return buffer;

  const { data, info } = await sharp(buffer)
    .greyscale()
    .resize({ width: 900, withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  let found = false;

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
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
  // Only crop when we clearly found an inset card (not full-frame)
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

async function resizeForOcr(buffer, targetWidth = 2200) {
  const meta = await sharp(buffer).metadata();
  const width = meta.width || 0;
  if (width >= targetWidth && width <= 3200) return buffer;
  const widthTarget = width > 3200 ? 2400 : targetWidth;
  return sharp(buffer)
    .resize({
      width: widthTarget,
      kernel: sharp.kernel.lanczos3,
      withoutEnlargement: false,
    })
    .toBuffer();
}

/**
 * Priority-ordered OCR variants for Indian ID cards.
 * Invert + blue channel help blue PAN cards / CamScanner scans.
 */
async function toOcrVariants(buffer) {
  const [simple, inverted, highContrast, blueNeg] = await Promise.all([
    sharp(buffer).greyscale().normalize().sharpen({ sigma: 1.2 }).png().toBuffer(),
    sharp(buffer)
      .modulate({ brightness: 1.3, saturation: 0.2 })
      .greyscale()
      .negate()
      .normalize()
      .sharpen()
      .png()
      .toBuffer(),
    sharp(buffer).greyscale().linear(1.7, -70).normalize().sharpen().png().toBuffer(),
    sharp(buffer)
      .extractChannel(2) // blue — strong on PAN
      .normalize()
      .negate()
      .normalize()
      .sharpen()
      .png()
      .toBuffer(),
  ]);

  return [inverted, simple, blueNeg, highContrast];
}

/**
 * Probe orientations with invert (strong on blue PAN cards).
 * Keep original orientation unless another angle is clearly better with ID text.
 * Note: some CamScanner portrait shots OCR better sideways than after 90° rotate.
 */
async function correctCardOrientation(buffer) {
  const angles = [0, 90, 270, 180];

  let bestBuffer = buffer;
  let bestScore = -Infinity;
  let bestAngle = 0;
  const scored = [];

  for (const angle of angles) {
    const rotated =
      angle === 0 ? buffer : await sharp(buffer).rotate(angle).toBuffer();

    const probe = await sharp(rotated)
      .resize({ width: 1800, withoutEnlargement: false })
      .modulate({ brightness: 1.3, saturation: 0.2 })
      .greyscale()
      .negate()
      .normalize()
      .sharpen()
      .png()
      .toBuffer();

    const result = await runOcrOnce(probe, { tessedit_pageseg_mode: '6' });
    let score = scoreOcrResult(result);

    const upper = (result.text || '').toUpperCase();
    if (/CAMSCANNER|SCANNED\s*BY/.test(upper) && score < 80) score -= 50;

    scored.push({ angle, score, rotated });
    if (score > bestScore) {
      bestScore = score;
      bestBuffer = rotated;
      bestAngle = angle;
    }

    // Strong ID read — stop early (prefer 0 when tied later)
    if (score >= 120) break;
  }

  const original = scored.find((s) => s.angle === 0);
  // Only rotate when the gain is meaningful; weak probes should not flip the card
  if (original && bestAngle !== 0) {
    if (bestScore < 60 || bestScore < original.score + 40) {
      bestBuffer = original.rotated;
      bestAngle = 0;
      bestScore = original.score;
    }
  }

  return { buffer: bestBuffer, angle: bestAngle, score: bestScore };
}

async function preprocessChain(imagePath) {
  let buffer = await fs.readFile(imagePath);
  const originalBuffer = buffer;

  buffer = await autoRotateExif(buffer);
  buffer = await cropCardRegion(buffer);
  const oriented = await correctCardOrientation(buffer);
  buffer = oriented.buffer;
  // Crop again after rotation (margins may change)
  buffer = await cropCardRegion(buffer);
  buffer = await resizeForOcr(buffer);

  const ocrVariants = await toOcrVariants(buffer);
  const processedBuffer = await sharp(buffer).normalize().sharpen().toBuffer();

  return {
    originalBuffer,
    processedBuffer,
    ocrBuffer: ocrVariants[0],
    ocrVariants,
    orientationAngle: oriented.angle,
  };
}

module.exports = {
  preprocessChain,
  autoRotateExif,
  resizeForOcr,
  toOcrVariants,
  correctCardOrientation,
  cropCardRegion,
};

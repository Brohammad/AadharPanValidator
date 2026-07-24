const sharp = require('sharp');
const config = require('../../config');
const { invertForOcr, enhanceContrast } = require('./normalize');

/**
 * OCR variants for phone photos of physical cards (invert helps blue PAN).
 * @param {Buffer} buffer
 * @param {{ fast?: boolean, maxVariants?: number }} [options]
 */
async function toOcrVariantsPhoto(buffer, { fast = false, maxVariants = null } = {}) {
  const limit = maxVariants != null ? maxVariants : fast ? 2 : 4;

  const simple = await sharp(buffer).greyscale().normalize().sharpen({ sigma: 1.0 }).png().toBuffer();

  if (limit <= 1) {
    return [simple];
  }

  const inverted = await invertForOcr(buffer, {
    brightness: fast ? 1.25 : 1.3,
    saturation: 0.2,
  });

  if (fast || limit <= 2) {
    return [inverted, simple].slice(0, limit);
  }

  const [highContrast, blueNeg] = await Promise.all([
    enhanceContrast(buffer).then((b) => sharp(b).sharpen().png().toBuffer()),
    sharp(buffer).extractChannel(2).normalize().negate().normalize().sharpen().png().toBuffer(),
  ]);

  return [inverted, simple, blueNeg, highContrast].slice(0, limit);
}

/** Greyscale variant for PDF / embedded (speed). */
async function toOcrVariantsPdf(buffer, { maxVariants = 1 } = {}) {
  const sized = await sharp(buffer)
    .resize({
      width: config.ocrResizeWidthPdf,
      withoutEnlargement: true,
      kernel: sharp.kernel.lanczos3,
    })
    .greyscale()
    .normalize()
    .sharpen({ sigma: 0.8 })
    .png()
    .toBuffer();
  return [sized].slice(0, maxVariants);
}

/** Stronger PAN blue-card variants (photo-in-PDF is often dark blue). */
async function toPanInvertVariant(buffer) {
  const width = config.ocrResizeWidthPhoto || 1800;
  return sharp(buffer)
    .resize({ width, withoutEnlargement: false, kernel: sharp.kernel.lanczos3 })
    .modulate({ brightness: 1.35, saturation: 0.1 })
    .greyscale()
    .negate()
    .normalize()
    .linear(1.4, -40)
    .sharpen({ sigma: 1.2 })
    .png()
    .toBuffer();
}

/** Extra PAN variants: blue-channel negate + high-contrast greyscale */
async function toPanOcrVariants(buffer, { maxVariants = 3 } = {}) {
  const width = config.ocrResizeWidthPhoto || 1800;
  const sized = await sharp(buffer)
    .resize({ width, withoutEnlargement: false, kernel: sharp.kernel.lanczos3 })
    .toBuffer();

  const [inverted, blueNeg, contrast] = await Promise.all([
    toPanInvertVariant(sized),
    sharp(sized)
      .extractChannel(2)
      .normalize()
      .negate()
      .normalize()
      .sharpen({ sigma: 1.0 })
      .png()
      .toBuffer(),
    sharp(sized)
      .greyscale()
      .normalize()
      .linear(1.8, -80)
      .sharpen()
      .png()
      .toBuffer(),
  ]);

  return [inverted, blueNeg, contrast].slice(0, maxVariants);
}

module.exports = {
  toOcrVariantsPhoto,
  toOcrVariantsPdf,
  toPanInvertVariant,
  toPanOcrVariants,
};

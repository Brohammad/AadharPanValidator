const sharp = require('sharp');
const { runOcrOnce } = require('./tesseract');

/** One bottom-band + invert pass for the 12-digit UID. */
async function refineAadhaarOcr(ocrResult, page) {
  const buffer = page?.processedBuffer || page?.ocrBuffer;
  if (!buffer) return ocrResult;

  try {
    const meta = await sharp(buffer).metadata();
    const w = meta.width || 0;
    const h = meta.height || 0;
    if (w < 200 || h < 200) return ocrResult;

    const region = {
      left: 0,
      top: Math.floor(h * 0.55),
      width: w,
      height: Math.floor(h * 0.45),
    };

    const crop = await sharp(buffer)
      .extract(region)
      .greyscale()
      .normalize()
      .linear(1.6, -45)
      .sharpen()
      .png()
      .toBuffer();
    const inverted = await sharp(crop).negate().normalize().png().toBuffer();

    const extras = [];
    for (const buf of [crop, inverted]) {
      const result = await runOcrOnce(buf, { tessedit_pageseg_mode: '6' });
      if (result.text && /\d{4}/.test(result.text)) extras.push(result.text);
    }

    if (!extras.length) return ocrResult;

    const merged = [ocrResult.text || '', '--- aadhaar number bands ---', ...extras]
      .filter(Boolean)
      .join('\n');
    const hasUid = /\d{4}[\s\-]?\d{4}[\s\-]?\d{4}/.test(merged);

    return {
      ...ocrResult,
      text: merged,
      ocrConfidence: Math.min(95, Math.max(ocrResult.ocrConfidence || 0, hasUid ? 55 : 45)),
      aadhaarRefine: { bands: extras.length, hasUid },
    };
  } catch {
    return ocrResult;
  }
}

module.exports = { refineAadhaarOcr };

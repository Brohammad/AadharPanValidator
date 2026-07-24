const sharp = require('sharp');
const { runOcrOnce } = require('./tesseract');

/**
 * Isolate near-black ink from blue PAN security pattern, then OCR.
 */
async function darkInkIsolate(buffer) {
  const { data, info } = await sharp(buffer)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(info.width * info.height);
  for (let i = 0, p = 0; i < data.length; i += info.channels, p++) {
    const y = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    out[p] = y < 75 ? 0 : 255;
  }
  return sharp(out, {
    raw: { width: info.width, height: info.height, channels: 1 },
  })
    .resize({ width: Math.max(info.width, 1100), kernel: sharp.kernel.nearest })
    .png()
    .toBuffer();
}

async function uprightSourceBuffer(page) {
  if (page?.originalBuffer) {
    const angle = page.orientationAngle || 0;
    const rotated =
      angle === 0
        ? page.originalBuffer
        : await sharp(page.originalBuffer).rotate(angle).toBuffer();
    return sharp(rotated)
      .resize({ width: 2400, withoutEnlargement: false })
      .toBuffer();
  }
  const buffer = page?.processedBuffer || page?.ocrBuffer;
  if (!buffer) return null;
  return sharp(buffer)
    .resize({ width: 2400, withoutEnlargement: false })
    .toBuffer();
}

/**
 * PAN refine: invert pass (name/father) + dark-ink strip (PAN number).
 * Uses originalBuffer at the detected orientation — processed greyscale
 * variants lose the black-ink vs blue-pattern separation.
 */
async function refinePanOcr(ocrResult, page) {
  try {
    const buffer = await uprightSourceBuffer(page);
    if (!buffer) return ocrResult;

    const meta = await sharp(buffer).metadata();
    const w = meta.width || 0;
    const h = meta.height || 0;
    if (w < 200 || h < 200) return ocrResult;

    const extras = [];

    const fullInv = await sharp(buffer)
      .modulate({ brightness: 1.35, saturation: 0.1 })
      .greyscale()
      .negate()
      .normalize()
      .linear(1.4, -30)
      .sharpen()
      .png()
      .toBuffer();
    const invOcr = await runOcrOnce(fullInv, { tessedit_pageseg_mode: '6' });
    if (invOcr.text && invOcr.text.trim().length > 12) extras.push(invOcr.text);

    const strip = await sharp(buffer)
      .extract({
        left: Math.floor(w * 0.28),
        top: Math.floor(h * 0.35),
        width: Math.floor(w * 0.45),
        height: Math.floor(h * 0.12),
      })
      .toBuffer();
    const isolated = await darkInkIsolate(strip);
    const panOcr = await runOcrOnce(isolated, { tessedit_pageseg_mode: '6' });
    if (panOcr.text && /[A-Za-z0-9]{6,}/.test(panOcr.text)) {
      extras.push(`PANINK ${panOcr.text}`);
    }

    // Second slightly lower band if first miss
    if (!/[A-Z]{5}[A-Z0-9]{3,}/i.test(panOcr.text || '')) {
      const strip2 = await sharp(buffer)
        .extract({
          left: Math.floor(w * 0.25),
          top: Math.floor(h * 0.36),
          width: Math.floor(w * 0.5),
          height: Math.floor(h * 0.1),
        })
        .toBuffer();
      const iso2 = await darkInkIsolate(strip2);
      const panOcr2 = await runOcrOnce(iso2, { tessedit_pageseg_mode: '6' });
      if (panOcr2.text && /[A-Za-z0-9]{6,}/.test(panOcr2.text)) {
        extras.push(`PANINK ${panOcr2.text}`);
      }
    }

    if (!extras.length) return ocrResult;

    const merged = [ocrResult.text || '', '--- pan refine ---', ...extras]
      .filter(Boolean)
      .join('\n');

    const cueBoost = /FATHER|PEMANENT|PERMANENT|ACCOUNT|INCOME|GOVT|[A-Z]{5}[0-9OISB]{4}[A-Z]|ANZAR/i.test(
      merged
    )
      ? 15
      : 0;

    return {
      ...ocrResult,
      text: merged,
      ocrConfidence: Math.min(95, Math.max(ocrResult.ocrConfidence || 0, 32) + cueBoost),
      panRefine: { bands: extras.length },
    };
  } catch {
    return ocrResult;
  }
}

module.exports = { refinePanOcr, darkInkIsolate };

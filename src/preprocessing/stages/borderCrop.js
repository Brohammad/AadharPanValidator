const sharp = require('sharp');

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

module.exports = { cropCardRegion };

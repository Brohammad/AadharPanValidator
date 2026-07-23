const sharp = require('sharp');

/**
 * Sharp-based image quality metrics (no OpenCV).
 * Blur uses Laplacian variance on a downscaled grayscale buffer.
 */
async function analyzeImageQuality(imageBuffer) {
  const metadata = await sharp(imageBuffer).metadata();
  const stats = await sharp(imageBuffer).stats();

  const channels = stats.channels || [];
  const meanBrightness =
    channels.length > 0
      ? channels.reduce((sum, ch) => sum + ch.mean, 0) / channels.length
      : 128;

  const contrast =
    channels.length > 0
      ? channels.reduce((sum, ch) => sum + (ch.stdev || 0), 0) / channels.length / 128
      : 0;

  const { data, info } = await sharp(imageBuffer)
    .greyscale()
    .resize({ width: 400, withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const width = info.width;
  const height = info.height;
  const pixels = data;

  const blur = laplacianVariance(pixels, width, height);
  const noise = estimateNoise(pixels, width, height);
  const skewAngle = estimateSkew(pixels, width, height);

  const fullWidth = metadata.width || 0;
  const fullHeight = metadata.height || 0;
  const estimatedDpi = metadata.density || Math.round(Math.max(fullWidth, fullHeight) / 8.5);

  return {
    blur: Math.round(blur * 100) / 100,
    brightness: Math.round(meanBrightness),
    contrast: Math.round(contrast * 1000) / 1000,
    noise: Math.round(noise * 1000) / 1000,
    skewAngle: Math.round(skewAngle * 10) / 10,
    rotation: metadata.orientation || 0,
    resolution: { width: fullWidth, height: fullHeight },
    estimatedDpi,
  };
}

function laplacianVariance(pixels, width, height) {
  const values = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const lap =
        -4 * pixels[i] +
        pixels[i - 1] +
        pixels[i + 1] +
        pixels[i - width] +
        pixels[i + width];
      values.push(lap);
    }
  }
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return variance;
}

function estimateNoise(pixels, width, height) {
  let diffSum = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y += 2) {
    for (let x = 1; x < width - 1; x += 2) {
      const i = y * width + x;
      const local =
        (pixels[i] +
          pixels[i - 1] +
          pixels[i + 1] +
          pixels[i - width] +
          pixels[i + width]) /
        5;
      diffSum += Math.abs(pixels[i] - local);
      count++;
    }
  }
  return count > 0 ? diffSum / count / 255 : 0;
}

function estimateSkew(pixels, width, height) {
  // Projection-profile style: find dominant horizontal edge tilt via row gradients
  const rowEdges = [];
  for (let y = 1; y < height - 1; y++) {
    let edgeSum = 0;
    let weightedX = 0;
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const gx = Math.abs(pixels[i + 1] - pixels[i - 1]);
      if (gx > 40) {
        edgeSum += gx;
        weightedX += x * gx;
      }
    }
    if (edgeSum > 0) {
      rowEdges.push({ y, cx: weightedX / edgeSum });
    }
  }

  if (rowEdges.length < 10) return 0;

  // Linear regression of center-x vs y → approximate skew
  const n = rowEdges.length;
  let sumY = 0;
  let sumX = 0;
  let sumYX = 0;
  let sumYY = 0;
  for (const p of rowEdges) {
    sumY += p.y;
    sumX += p.cx;
    sumYX += p.y * p.cx;
    sumYY += p.y * p.y;
  }
  const denom = n * sumYY - sumY * sumY;
  if (Math.abs(denom) < 1e-6) return 0;
  const slope = (n * sumYX - sumY * sumX) / denom;
  const angleDeg = (Math.atan(slope) * 180) / Math.PI;
  if (Math.abs(angleDeg) > 20) return 0;
  return angleDeg;
}

module.exports = { analyzeImageQuality };

const sharp = require('sharp');
const { runOcrOnce, scoreOrientationProbe } = require('../../ocr/tesseract');

/**
 * Probe orientations with invert (phone photos) — max 2–3 angles, small probe.
 */
async function correctCardOrientation(buffer, { skipIfExifUpright = false, meta = null } = {}) {
  // If EXIF already rotated to portrait/landscape that looks upright, still probe
  // but callers can skip when orientationAngle already known.
  if (skipIfExifUpright && meta?.orientation == null) {
    // no-op hint for callers; still run probes unless they skip entirely
  }

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
    let score = scoreOrientationProbe(result);
    const upper = (result.text || '').toUpperCase();
    if (/CAMSCANNER|SCANNED\s*BY/.test(upper) && score < 80) score -= 50;

    const beatsBest =
      angle === 0 ? score > bestScore : score >= bestScore + 20;
    if (beatsBest) {
      bestScore = score;
      bestBuffer = rotated;
      bestAngle = angle;
    }
    if (angle === 0 && score >= 90) break;
  }

  return { buffer: bestBuffer, angle: bestAngle, score: bestScore };
}

/**
 * Cheap uprightness score without full OCR — horizontal edge / text-like runs.
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

module.exports = {
  correctCardOrientation,
  correctEmbeddedOrientation,
  estimateUprightScore,
};

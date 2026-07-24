#!/usr/bin/env node
/**
 * Generate degraded fixture variants from clean mocks for regression testing.
 * Profiles: clean (copy), blurry, rotated, screenshot-like.
 *
 * Usage: node scripts/generate-fixtures.js
 * Requires assets/mocks/ to exist (run npm run mocks first).
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const MOCK_DIR = path.resolve(__dirname, '../assets/mocks');
const OUT_DIR = path.resolve(__dirname, '../assets/fixtures');

async function ensureDir(dir) {
  await fs.promises.mkdir(dir, { recursive: true });
}

async function makeBlurry(input, output) {
  await sharp(input).blur(3.5).jpeg({ quality: 60 }).toFile(output);
}

async function makeRotated(input, output) {
  await sharp(input).rotate(90).png().toFile(output);
}

async function makeScreenshotLike(input, output) {
  // Soften + overlay chrome bar to mimic phone screenshot
  const base = await sharp(input)
    .resize({ width: 1200, withoutEnlargement: true })
    .modulate({ brightness: 1.05, saturation: 0.85 })
    .png()
    .toBuffer();
  const baseMeta = await sharp(base).metadata();
  const w = baseMeta.width || 800;
  const h = baseMeta.height || 600;
  const bar = Buffer.from(
    `<svg width="${w}" height="36"><rect width="100%" height="100%" fill="#1c1c1e"/><text x="12" y="24" fill="#fff" font-size="14" font-family="sans-serif">Screenshot</text></svg>`
  );
  await sharp({
    create: {
      width: w,
      height: h + 36,
      channels: 3,
      background: { r: 240, g: 240, b: 240 },
    },
  })
    .composite([
      { input: bar, top: 0, left: 0 },
      { input: base, top: 36, left: 0 },
    ])
    .jpeg({ quality: 70 })
    .toFile(output);
}

async function main() {
  await ensureDir(OUT_DIR);
  if (!fs.existsSync(MOCK_DIR)) {
    console.error('Missing assets/mocks — run npm run mocks first');
    process.exit(1);
  }

  const files = (await fs.promises.readdir(MOCK_DIR)).filter((f) =>
    /\.(png|jpg|jpeg)$/i.test(f)
  );

  let count = 0;
  for (const file of files) {
    const input = path.join(MOCK_DIR, file);
    const base = path.basename(file, path.extname(file));

    const cleanOut = path.join(OUT_DIR, `${base}.clean${path.extname(file)}`);
    await fs.promises.copyFile(input, cleanOut);
    count++;

    await makeBlurry(input, path.join(OUT_DIR, `${base}.blurry.jpg`));
    count++;
    await makeRotated(input, path.join(OUT_DIR, `${base}.rotated.png`));
    count++;
    await makeScreenshotLike(input, path.join(OUT_DIR, `${base}.screenshot.jpg`));
    count++;
  }

  // Copy PDF mocks as scanned/embedded stand-ins
  const pdfs = (await fs.promises.readdir(MOCK_DIR)).filter((f) => /\.pdf$/i.test(f));
  for (const file of pdfs) {
    const base = path.basename(file, '.pdf');
    await fs.promises.copyFile(
      path.join(MOCK_DIR, file),
      path.join(OUT_DIR, `${base}.scanned.pdf`)
    );
    count++;
  }

  console.log(`Generated ${count} fixtures in ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

const sharp = require('sharp');

/**
 * Passport page region crops for targeted OCR.
 * Coordinates are fractions of width/height on the processed page image.
 */
const REGIONS = {
  /** Type / Code / Passport No / Nationality */
  headerRight: { left: 0.35, top: 0.06, width: 0.60, height: 0.22 },
  /** Passport number band */
  passportNumber: { left: 0.48, top: 0.10, width: 0.45, height: 0.14 },
  /** Wider number+nationality band (threshold-friendly) */
  passportNumberWide: { left: 0.45, top: 0.08, width: 0.50, height: 0.18 },
  /** Visual zone excluding photo */
  visualZone: { left: 0.30, top: 0.05, width: 0.68, height: 0.70 },
  /** MRZ strip */
  mrz: { left: 0.02, top: 0.76, width: 0.96, height: 0.22 },
};

async function extractRegion(buffer, region, options = {}) {
  const meta = await sharp(buffer).metadata();
  const w = meta.width || 1;
  const h = meta.height || 1;

  const left = Math.max(0, Math.floor(w * region.left));
  const top = Math.max(0, Math.floor(h * region.top));
  const width = Math.min(w - left, Math.floor(w * region.width));
  const height = Math.min(h - top, Math.floor(h * region.height));
  if (width < 20 || height < 12) return null;

  let pipeline = sharp(buffer).extract({ left, top, width, height });

  switch (options.variant || 'normalize') {
    case 'threshold':
      pipeline = pipeline.greyscale().normalize().threshold(options.threshold ?? 145);
      break;
    case 'linear':
      pipeline = pipeline.greyscale().linear(1.6, -50).normalize().sharpen();
      break;
    case 'invert':
      pipeline = pipeline.greyscale().normalize().negate().normalize().sharpen();
      break;
    case 'mrz':
      pipeline = pipeline.greyscale().normalize().linear(1.5, -40).sharpen();
      break;
    default:
      pipeline = pipeline.greyscale().normalize().sharpen();
  }

  const targetWidth = options.targetWidth || Math.max(900, width * 2);
  return pipeline.resize({ width: targetWidth, kernel: sharp.kernel.lanczos3 }).png().toBuffer();
}

async function buildPassportRegionBuffers(pageBuffer) {
  // Fast path: 4 regions (header + 2 number variants + MRZ)
  const jobs = [
    { key: 'headerRight', region: REGIONS.headerRight, variant: 'normalize', targetWidth: 1100 },
    {
      key: 'numberThresh',
      region: REGIONS.passportNumberWide,
      variant: 'threshold',
      threshold: 145,
      targetWidth: 1000,
    },
    {
      key: 'numberNorm',
      region: REGIONS.passportNumber,
      variant: 'normalize',
      targetWidth: 1000,
    },
    { key: 'mrz', region: REGIONS.mrz, variant: 'mrz', targetWidth: 1800 },
  ];

  const out = {};
  await Promise.all(
    jobs.map(async (job) => {
      out[job.key] = await extractRegion(pageBuffer, job.region, job);
    })
  );
  return out;
}

module.exports = {
  REGIONS,
  extractRegion,
  buildPassportRegionBuffers,
};

const sharp = require('sharp');

async function toGrayscale(buffer) {
  return sharp(buffer).greyscale().toBuffer();
}

async function normalizeBrightness(buffer) {
  return sharp(buffer).normalize().toBuffer();
}

async function enhanceContrast(buffer, { linear = 1.7, offset = -70 } = {}) {
  return sharp(buffer).greyscale().linear(linear, offset).normalize().toBuffer();
}

/** Light denoise via mild blur then sharpen — keeps text edges */
async function denoise(buffer) {
  return sharp(buffer).median(1).sharpen({ sigma: 0.8 }).toBuffer();
}

async function invertForOcr(buffer, { brightness = 1.25, saturation = 0.2 } = {}) {
  return sharp(buffer)
    .modulate({ brightness, saturation })
    .greyscale()
    .negate()
    .normalize()
    .sharpen()
    .png()
    .toBuffer();
}

module.exports = {
  toGrayscale,
  normalizeBrightness,
  enhanceContrast,
  denoise,
  invertForOcr,
};

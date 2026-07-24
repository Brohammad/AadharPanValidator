const sharp = require('sharp');

async function autoRotateExif(buffer) {
  return sharp(buffer).rotate().toBuffer();
}

module.exports = { autoRotateExif };

const { autoRotateExif } = require('./orientation');
const { correctCardOrientation, correctEmbeddedOrientation, estimateUprightScore } = require('./deskew');
const { cropCardRegion } = require('./borderCrop');
const { resizeForOcr } = require('./resize');
const {
  toGrayscale,
  normalizeBrightness,
  enhanceContrast,
  denoise,
  invertForOcr,
} = require('./normalize');
const { toOcrVariantsPhoto, toOcrVariantsPdf, toPanInvertVariant } = require('./variants');

/**
 * Profile → ordered stage names for documentation / debugging.
 */
const PROFILES = {
  photo: ['exif', 'borderCrop', 'orientationOcr', 'resize', 'variants'],
  embedded: ['exif', 'orientationEdge', 'resize', 'variants'],
  pdf_scan: ['exif', 'borderCrop', 'resize', 'variants'],
};

module.exports = {
  PROFILES,
  autoRotateExif,
  correctCardOrientation,
  correctEmbeddedOrientation,
  estimateUprightScore,
  cropCardRegion,
  resizeForOcr,
  toGrayscale,
  normalizeBrightness,
  enhanceContrast,
  denoise,
  invertForOcr,
  toOcrVariantsPhoto,
  toOcrVariantsPdf,
  toPanInvertVariant,
};

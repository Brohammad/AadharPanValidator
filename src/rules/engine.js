const layoutDetector = require('./detectors/layoutDetector');
const logoDetector = require('./detectors/logoDetector');
const checksumValidator = require('./detectors/checksumValidator');
const screenshotDetector = require('./detectors/screenshotDetector');
const blurDetector = require('./detectors/blurDetector');
const resolutionDetector = require('./detectors/resolutionDetector');
const fontDetector = require('./detectors/fontDetector');
const templateMatcher = require('./detectors/templateMatcher');
const cropDetector = require('./detectors/cropDetector');
const typedTextDetector = require('./detectors/typedTextDetector');
const tamperingDetector = require('./detectors/tamperingDetector');
const ocrQualityDetector = require('./detectors/ocrQualityDetector');

const DETECTOR_MAP = {
  layoutDetector,
  logoDetector,
  checksumValidator,
  screenshotDetector,
  blurDetector,
  resolutionDetector,
  fontDetector,
  templateMatcher,
  cropDetector,
  typedTextDetector,
  tamperingDetector,
  ocrQualityDetector,
};

async function runRuleEngine(ctx, detectorNames) {
  const names = detectorNames || Object.keys(DETECTOR_MAP);
  const results = await Promise.all(
    names.map(async (name) => {
      const detector = DETECTOR_MAP[name];
      if (!detector) return null;
      try {
        return detector(ctx);
      } catch (err) {
        return {
          name,
          score: 0,
          passed: false,
          weight: 0,
          details: { error: err.message },
          fraudMessage: `Detector ${name} failed`,
        };
      }
    })
  );
  return results.filter(Boolean);
}

module.exports = { runRuleEngine, DETECTOR_MAP };

class BaseDocument {
  constructor(type, label) {
    this.type = type;
    this.label = label;
  }

  identify(_features, _ocr) {
    throw new Error('identify() must be implemented');
  }

  extract(_ocr) {
    throw new Error('extract() must be implemented');
  }

  validate(_data) {
    throw new Error('validate() must be implemented');
  }

  authenticityChecks() {
    return [
      'layoutDetector',
      'logoDetector',
      'checksumValidator',
      'screenshotDetector',
      'blurDetector',
      'resolutionDetector',
      'fontDetector',
      'templateMatcher',
      'cropDetector',
      'typedTextDetector',
      'tamperingDetector',
    ];
  }
}

module.exports = BaseDocument;

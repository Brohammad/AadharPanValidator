const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { evaluateOcrQuality } = require('../src/pipeline/ocrQuality');
const { classifyDocument } = require('../src/pipeline/classify');
const { scoreExtractionConfidence } = require('../src/pipeline/extractionConfidence');
const { buildStoppedResponse, buildCompletedResponse } = require('../src/pipeline/responseBuilder');
const { buildDecision, aggregateScores } = require('../src/rules/aggregator');
const { sanitizeLogPayload } = require('../src/utils/safeLog');
const CinDocument = require('../src/documents/cinDocument');
const AadhaarDocument = require('../src/documents/aadhaarDocument');

describe('OCR quality gate', () => {
  it('fails with OCR_CONFIDENCE_LOW code', () => {
    const result = evaluateOcrQuality(
      { text: 'A'.repeat(50) + '1234567890', ocrConfidence: 10 },
      { blur: 100 }
    );
    assert.equal(result.passed, false);
    assert.ok(result.reasons.some((r) => r.code === 'OCR_CONFIDENCE_LOW'));
  });

  it('fails empty text with OCR_TEXT_EMPTY', () => {
    const result = evaluateOcrQuality({ text: '   ', ocrConfidence: 90 });
    assert.equal(result.passed, false);
    assert.ok(result.reasons.some((r) => r.code === 'OCR_TEXT_EMPTY'));
  });

  it('passes healthy OCR', () => {
    const result = evaluateOcrQuality(
      {
        text: 'Certificate of Incorporation CIN U72900MH2018PTC312456 Company Name AVIO',
        ocrConfidence: 80,
      },
      { blur: 120 }
    );
    assert.equal(result.passed, true);
  });
});

describe('classification type-fit', () => {
  it('returns UNKNOWN when signals are insufficient', () => {
    const doc = new CinDocument();
    const result = classifyDocument(
      doc,
      { text: 'hello world random noise nothing useful here at all', signals: {} },
      { ocrConfidence: 70, text: 'hello world' }
    );
    assert.equal(result.passed, false);
    assert.equal(result.documentType, 'UNKNOWN');
    assert.ok(result.reasons.length > 0);
    assert.ok(result.matchedSignals || result.signals);
  });

  it('passes CIN with strong signals', () => {
    const doc = new CinDocument();
    const text =
      'Certificate of Incorporation CIN U72900MH2018PTC312456 Ministry of Corporate Affairs ROC Mumbai';
    const result = classifyDocument(
      doc,
      { text, signals: {} },
      { ocrConfidence: 80, text }
    );
    assert.equal(result.passed, true);
    assert.equal(result.documentType, 'CIN');
  });
});

describe('extraction confidence', () => {
  it('reduces score for missing mandatory fields', () => {
    const scored = scoreExtractionConfidence({
      ocrConfidence: 80,
      mandatoryFields: ['a', 'b'],
      optionalFields: [],
      data: { a: 'x' },
      mandatoryWeight: 0.7,
      optionalWeight: 0,
      ocrWeight: 0.3,
    });
    assert.ok(scored.extractionConfidence < 90);
    assert.ok(scored.extractionReasons.some((r) => r.code === 'MISSING_MANDATORY_FIELDS'));
  });

  it('flags below threshold', () => {
    const scored = scoreExtractionConfidence({
      ocrConfidence: 20,
      mandatoryFields: ['a'],
      data: {},
      mandatoryWeight: 0.8,
      optionalWeight: 0,
      ocrWeight: 0.2,
    });
    assert.equal(scored.extractionBelowThreshold, true);
  });
});

describe('response builder', () => {
  it('stopped responses include mode and stopReason', () => {
    const res = buildStoppedResponse({
      stage: 'ocr',
      reason: 'OCR quality below configured threshold',
      reasons: [{ code: 'OCR_CONFIDENCE_LOW', message: 'too low', stage: 'ocr' }],
      ocrConfidence: 12,
      mode: 'extraction',
    });
    assert.equal(res.status, 'stopped');
    assert.equal(res.mode, 'extraction');
    assert.equal(res.stopReason, 'OCR quality below configured threshold');
    assert.equal(res.riskAssessment, null);
    assert.equal(res.authenticity, null);
  });

  it('verification completed includes riskAssessment and authenticity alias', () => {
    const aggregation = aggregateScores([
      { name: 'checksumValidator', score: 1, weight: 20, passed: true },
      { name: 'layoutDetector', score: 0.9, weight: 20, passed: true },
      { name: 'logoDetector', score: 0.9, weight: 15, passed: true },
      { name: 'ocrQualityDetector', score: 0.9, weight: 10, passed: true },
      { name: 'screenshotDetector', score: 0.9, weight: 15, passed: true },
    ]);
    const decision = buildDecision({ passed: true, checks: {} }, aggregation);
    const doc = new AadhaarDocument();
    const res = buildCompletedResponse({
      document: doc,
      decision,
      aggregation,
      ocrConfidence: 80,
      extractionConfidence: 70,
      extractionReasons: [],
      data: { aadhaar: 'x' },
      classification: {
        requestedType: 'AADHAAR',
        documentType: 'AADHAAR',
        classificationConfidence: 80,
        threshold: 35,
        reasons: [],
        signals: {},
      },
    });
    assert.ok(res.riskAssessment);
    assert.ok(res.authenticity);
    assert.equal(res.riskAssessment.overallScore, res.authenticity.score);
    assert.equal(typeof res.riskAssessment.passed, 'boolean');
  });
});

describe('safe logging', () => {
  it('strips OCR text and data fields', () => {
    const clean = sanitizeLogPayload({
      requestId: 'abc',
      stage: 'ocr',
      fullOcrText: 'SECRET AADHAAR 1234',
      data: { aadhaar: '1234' },
      ocrConfidence: 50,
    });
    assert.equal(clean.requestId, 'abc');
    assert.equal(clean.ocrConfidence, 50);
    assert.equal(clean.fullOcrText, undefined);
    assert.equal(clean.data, undefined);
  });
});

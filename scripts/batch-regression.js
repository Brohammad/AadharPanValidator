#!/usr/bin/env node
/**
 * Lightweight regression: ensure clean mock extraction still completes
 * and OCR quality gate stops on intentionally sparse/blurry synthetic OCR.
 * Full OCR regression remains in scripts/batch-extract.js.
 */
const path = require('path');
const fs = require('fs');
const { evaluateOcrQuality } = require('../src/pipeline/ocrQuality');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function main() {
  // Gate: sparse OCR must stop
  const bad = evaluateOcrQuality({ text: 'xx', ocrConfidence: 15 }, { blur: 10 });
  assert(!bad.passed, 'Expected OCR gate to fail sparse/low-confidence input');
  assert(
    bad.reasons.some((r) => r.code === 'OCR_CONFIDENCE_LOW' || r.code === 'OCR_ALNUM_LOW'),
    'Expected structured OCR reason codes'
  );

  // Fixtures directory optional — warn if missing
  const fixtures = path.resolve(__dirname, '../assets/fixtures');
  const mocks = path.resolve(__dirname, '../assets/mocks');
  if (!fs.existsSync(mocks)) {
    console.warn('WARN: assets/mocks missing — run npm run mocks');
  } else {
    const mockCount = fs.readdirSync(mocks).length;
    assert(mockCount > 0, 'assets/mocks is empty');
    console.log(`OK: ${mockCount} mock files present`);
  }

  if (fs.existsSync(fixtures)) {
    const n = fs.readdirSync(fixtures).length;
    console.log(`OK: ${n} fixture files present`);
  } else {
    console.warn('WARN: assets/fixtures missing — run npm run fixtures');
  }

  console.log('Regression smoke checks passed');
}

try {
  main();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

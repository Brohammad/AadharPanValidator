#!/usr/bin/env node
/**
 * Batch-test the 4 extraction document types across PDF / PNG / JPG mocks.
 * Usage: node scripts/batch-extract.js
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { verifyDocument } = require('../src/pipeline/orchestrator');
const { terminateOcr } = require('../src/ocr/tesseract');

const MOCK_DIR = path.resolve(__dirname, '../assets/mocks');
const FORMATS = ['pdf', 'png', 'jpg'];

const CASES = [
  {
    slug: 'cin',
    expectType: 'CIN',
    files: {
      cin: {
        cinNumber: 'U72900MH2018PTC312456',
        companyName: /AVIO SECURITY SERVICES/i,
      },
      'cin-2': {
        cinNumber: 'L85110DL2020PLC401122',
        companyName: /SKYLINE AVIATION/i,
      },
    },
  },
  {
    slug: 'security-clearance',
    expectType: 'SECURITY_CLEARANCE',
    files: {
      'security-clearance': {
        employeeName: /RAHUL MEHTA/i,
        clearanceType: /Airport Entry Permit|Security Clearance/i,
        clearanceNumber: /SC-BOM-2024-00482/i,
      },
      'security-clearance-2': {
        employeeName: /SNEHA KAPOOR/i,
        clearanceType: /Background Verification|Security Clearance/i,
        clearanceNumber: /SC-DEL-2025-00901/i,
      },
    },
  },
  {
    slug: 'security-programme',
    expectType: 'SECURITY_PROGRAMME',
    files: {
      'security-programme': {
        programmeTitle: /Airport Security Programme|SECURITY PROGRAMME/i,
        documentNumber: /ASP-BOM-2024-01/i,
        version: /3\.2/,
      },
      'security-programme-2': {
        programmeTitle: /Terminal Security Programme|SECURITY PROGRAM/i,
        documentNumber: /DOC-ASP-DEL-09/i,
        version: /1\.0/,
      },
    },
  },
  {
    slug: 'authority-letter',
    expectType: 'AUTHORITY_LETTER',
    files: {
      'authority-letter': {
        authorizedPerson: /PRIYA NAIR/i,
        companyName: /AVIO SECURITY SERVICES/i,
        letterReferenceNumber: /ASL\/2024\/092/i,
      },
      'authority-letter-2': {
        authorizedPerson: /AMIT VERMA/i,
        companyName: /SKYLINE AVIATION/i,
        letterReferenceNumber: /ASL-DEL-331/i,
      },
    },
  },
];

function buildSamples() {
  const samples = [];
  let id = 1;
  for (const c of CASES) {
    for (const [base, expectFields] of Object.entries(c.files)) {
      for (const fmt of FORMATS) {
        samples.push({
          id: id++,
          slug: c.slug,
          expectType: c.expectType,
          file: `${base}.${fmt}`,
          format: fmt,
          expectFields,
        });
      }
    }
  }
  return samples;
}

function ensureMocks(samples) {
  const missing = samples.filter((s) => !fs.existsSync(path.join(MOCK_DIR, s.file)));
  if (missing.length === 0) return;
  console.log('Generating mocks…');
  const r = spawnSync(process.execPath, [path.join(__dirname, 'generate-mocks.js')], {
    stdio: 'inherit',
  });
  if (r.status !== 0) throw new Error('generate-mocks.js failed');
}

function fieldMatches(actual, expected) {
  if (expected == null) return true;
  if (actual == null || actual === '') return false;
  const s = String(actual);
  if (expected instanceof RegExp) return expected.test(s);
  return s.toUpperCase().includes(String(expected).toUpperCase());
}

async function main() {
  const samples = buildSamples();
  ensureMocks(samples);

  const results = [];
  let passed = 0;

  for (const sample of samples) {
    const filePath = path.join(MOCK_DIR, sample.file);
    const t0 = Date.now();
    try {
      const r = await verifyDocument(
        filePath,
        path.basename(filePath),
        `extract-${sample.id}`,
        sample.slug
      );

      const fieldChecks = {};
      let fieldsOk = true;
      for (const [key, expected] of Object.entries(sample.expectFields)) {
        const ok = fieldMatches(r.data?.[key], expected);
        fieldChecks[key] = { ok, actual: r.data?.[key] ?? null };
        if (!ok) fieldsOk = false;
      }

      const typeOk = r.documentType === sample.expectType;
      const modeOk = r.mode === 'extraction';
      const ok = typeOk && modeOk && fieldsOk && !r.error;

      results.push({
        id: sample.id,
        file: sample.file,
        format: sample.format,
        slug: sample.slug,
        expectType: sample.expectType,
        documentType: r.documentType,
        mode: r.mode,
        ok,
        typeOk,
        modeOk,
        fieldsOk,
        fieldChecks,
        extractionConfidence: r.extractionConfidence,
        extractionIssues: r.extractionIssues || [],
        ocrConfidence: r.ocrConfidence,
        data: r.data,
        ms: Date.now() - t0,
        error: r.error || null,
      });

      if (ok) passed++;
      const status = ok ? 'PASS' : 'FAIL';
      console.log(
        `${String(sample.id).padStart(2)} ${status} ${sample.format.padEnd(3)} ` +
          `${String(r.documentType).padEnd(20)} ocr=${r.ocrConfidence} ` +
          `extract=${r.extractionConfidence} ${Date.now() - t0}ms | ${sample.file}`
      );
      if (!ok) {
        for (const [k, v] of Object.entries(fieldChecks)) {
          if (!v.ok) console.log(`     miss ${k}: got ${JSON.stringify(v.actual)}`);
        }
        if (!typeOk) console.log(`     type: got ${r.documentType}`);
        if (r.extractionIssues?.length) {
          console.log(`     issues: ${r.extractionIssues.join('; ')}`);
        }
      }
    } catch (err) {
      results.push({
        id: sample.id,
        file: sample.file,
        format: sample.format,
        slug: sample.slug,
        ok: false,
        error: err.message,
        ms: Date.now() - t0,
      });
      console.error(`ERR ${sample.id} ${sample.file}: ${err.message}`);
    }
  }

  const byFormat = {};
  for (const fmt of FORMATS) {
    const rows = results.filter((r) => r.format === fmt);
    byFormat[fmt] = {
      passed: rows.filter((r) => r.ok).length,
      total: rows.length,
    };
  }

  const out = path.resolve(__dirname, '../temp/batch-extract-results.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ summary: { passed, total: samples.length, byFormat }, results }, null, 2));

  console.log(`\n${passed}/${samples.length} passed`);
  for (const fmt of FORMATS) {
    console.log(`  ${fmt}: ${byFormat[fmt].passed}/${byFormat[fmt].total}`);
  }
  console.log(`Wrote ${out}`);

  await terminateOcr();
  process.exit(passed === samples.length ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await terminateOcr();
  process.exit(1);
});

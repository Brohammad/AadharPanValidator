#!/usr/bin/env node
/**
 * Batch-test extraction document types against mock PDFs.
 * Usage: node scripts/batch-extract.js
 *
 * Generates mocks first if missing.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { verifyDocument } = require('../src/pipeline/orchestrator');
const { terminateOcr } = require('../src/ocr/tesseract');

const MOCK_DIR = path.resolve(__dirname, '../assets/mocks');

const SAMPLES = [
  {
    id: 1,
    slug: 'cin',
    expectType: 'CIN',
    file: 'mock-cin.pdf',
    expectFields: {
      cinNumber: 'U72900MH2018PTC312456',
      companyName: /AVIO SECURITY SERVICES/i,
    },
  },
  {
    id: 2,
    slug: 'security-clearance',
    expectType: 'SECURITY_CLEARANCE',
    file: 'mock-security-clearance.pdf',
    expectFields: {
      employeeName: /RAHUL MEHTA/i,
      clearanceType: /Airport Entry Permit|Security Clearance/i,
      clearanceNumber: /SC-BOM-2024-00482/i,
    },
  },
  {
    id: 3,
    slug: 'security-programme',
    expectType: 'SECURITY_PROGRAMME',
    file: 'mock-security-programme.pdf',
    expectFields: {
      programmeTitle: /Airport Security Programme|SECURITY PROGRAMME/i,
      documentNumber: /ASP-BOM-2024-01/i,
      version: /3\.2/,
    },
  },
  {
    id: 4,
    slug: 'authority-letter',
    expectType: 'AUTHORITY_LETTER',
    file: 'mock-authority-letter.pdf',
    expectFields: {
      authorizedPerson: /PRIYA NAIR/i,
      companyName: /AVIO SECURITY SERVICES/i,
      letterReferenceNumber: /ASL\/2024\/092/i,
    },
  },
];

function ensureMocks() {
  const missing = SAMPLES.filter((s) => !fs.existsSync(path.join(MOCK_DIR, s.file)));
  if (missing.length === 0) return;
  console.log('Generating mock PDFs…');
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
  ensureMocks();

  const results = [];
  let passed = 0;

  for (const sample of SAMPLES) {
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

      const row = {
        id: sample.id,
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
      };
      results.push(row);

      if (ok) passed++;
      const status = ok ? 'PASS' : 'FAIL';
      console.log(
        `${String(sample.id).padStart(2)} ${status} ${String(r.documentType).padEnd(20)} ` +
          `ocr=${r.ocrConfidence} extract=${r.extractionConfidence} ${row.ms}ms | ${sample.slug}`
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
        slug: sample.slug,
        ok: false,
        error: err.message,
        ms: Date.now() - t0,
      });
      console.error(`ERR ${sample.id} ${sample.slug}: ${err.message}`);
    }
  }

  const out = path.resolve(__dirname, '../temp/batch-extract-results.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(results, null, 2));
  console.log(`\n${passed}/${SAMPLES.length} passed`);
  console.log(`Wrote ${out}`);

  await terminateOcr();
  process.exit(passed === SAMPLES.length ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await terminateOcr();
  process.exit(1);
});

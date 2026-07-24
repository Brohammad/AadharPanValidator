#!/usr/bin/env node
/**
 * Extended live pipeline test across fixtures, samples, uploads, and synthetics.
 */
const fs = require('fs');
const path = require('path');
const { processDocument } = require('../src/pipeline/orchestrator');
const { terminateOcr } = require('../src/ocr/tesseract');

const ROOT = path.resolve(__dirname, '..');

function inferSlug(name) {
  const n = name.toLowerCase();
  if (n.includes('passport') || n.startsWith('pp-') || n.includes('pass')) return 'passport';
  if (n.includes('aadhaar') || n.includes('aadhar')) return 'aadhaar';
  if (n.includes('pan') || n.includes('synthetic-pan')) return 'pan';
  if (n.includes('cin')) return 'cin';
  if (n.includes('clearance')) return 'security-clearance';
  if (n.includes('programme') || n.includes('program')) return 'security-programme';
  if (n.includes('authority') || n.includes('letter')) return 'authority-letter';
  return null;
}

const CASES = [];

// --- Synthesized fixtures (representative set per profile) ---
const FIX = path.join(ROOT, 'assets/fixtures');
const fixturePicks = [
  ['cin.blurry.jpg', 'cin'],
  ['cin.rotated.png', 'cin'],
  ['cin.screenshot.jpg', 'cin'],
  ['cin.scanned.pdf', 'cin'],
  ['cin-2.blurry.jpg', 'cin'],
  ['security-clearance.blurry.jpg', 'security-clearance'],
  ['security-clearance.rotated.png', 'security-clearance'],
  ['security-clearance.screenshot.jpg', 'security-clearance'],
  ['security-clearance.scanned.pdf', 'security-clearance'],
  ['security-programme.blurry.jpg', 'security-programme'],
  ['security-programme.rotated.png', 'security-programme'],
  ['security-programme.screenshot.jpg', 'security-programme'],
  ['authority-letter.blurry.jpg', 'authority-letter'],
  ['authority-letter.rotated.png', 'authority-letter'],
  ['authority-letter.screenshot.jpg', 'authority-letter'],
  ['authority-letter.scanned.pdf', 'authority-letter'],
];
for (const [file, slug] of fixturePicks) {
  const p = path.join(FIX, file);
  if (fs.existsSync(p)) CASES.push({ label: `fixture:${file}`, path: p, slug, group: 'fixture' });
}

// --- Passport sample ---
const passport = path.join(ROOT, 'assets/samples/indian-passport.png');
if (fs.existsSync(passport)) {
  CASES.push({ label: 'sample:indian-passport.png', path: passport, slug: 'passport', group: 'sample' });
}

// --- Temp synthetics / prior uploads ---
const TEMP = path.join(ROOT, 'temp');
for (const file of [
  'synthetic-pan.png',
  'synthetic-pan.pdf',
  'alex-thomas-fake.png',
  'last-upload.png',
  'pp-try.png',
]) {
  const p = path.join(TEMP, file);
  if (!fs.existsSync(p)) continue;
  const slug = inferSlug(file) || (file.includes('alex') ? 'passport' : null);
  if (!slug) continue;
  CASES.push({ label: `temp:${file}`, path: p, slug, group: 'temp' });
}

// --- uploads/ folder ---
const UP = path.join(ROOT, 'uploads');
if (fs.existsSync(UP)) {
  for (const file of fs.readdirSync(UP)) {
    if (!/\.(png|jpe?g|pdf)$/i.test(file)) continue;
    const p = path.join(UP, file);
    // Guess slug by trying cin first for PDFs that look corporate; otherwise try multiple later
    CASES.push({ label: `upload:${file}`, path: p, slug: null, group: 'upload', trySlugs: ['passport', 'pan', 'aadhaar', 'cin'] });
  }
}

function summarize(result) {
  const reasons = (result.reasons || [])
    .map((r) => (typeof r === 'string' ? r : r.code || r.message))
    .slice(0, 3);
  return {
    status: result.status,
    stage: result.stage,
    documentType: result.documentType,
    ocr: result.ocrConfidence,
    classify: result.classificationConfidence,
    extract: result.extractionConfidence,
    validation: result.validation?.passed ?? null,
    risk: result.riskAssessment?.overallScore ?? result.authenticity?.score ?? null,
    stopReason: result.stopReason || result.reason || null,
    reasons,
    keyFields: pickFields(result),
  };
}

function pickFields(result) {
  const d = result.data || {};
  const keys = [
    'cinNumber',
    'companyName',
    'passportNumber',
    'surname',
    'givenName',
    'pan',
    'aadhaar',
    'name',
    'employeeName',
    'clearanceType',
    'programmeTitle',
    'authorizedPerson',
  ];
  const out = {};
  for (const k of keys) {
    if (d[k]) out[k] = String(d[k]).slice(0, 60);
  }
  return out;
}

async function runOne(c) {
  if (c.slug) {
    const result = await processDocument(c.path, path.basename(c.path), `live-${c.label}`, c.slug);
    return { ...c, result: summarize(result), tried: [c.slug] };
  }

  // Uploads with unknown type: try each slug, pick best completed
  let best = null;
  const tried = [];
  for (const slug of c.trySlugs || []) {
    tried.push(slug);
    try {
      const result = await processDocument(c.path, path.basename(c.path), `live-${c.label}-${slug}`, slug);
      const summary = summarize(result);
      if (!best) best = { summary, slug };
      if (summary.status === 'completed' && (summary.classify || 0) >= (best.summary.classify || 0)) {
        best = { summary, slug };
      }
      if (summary.status === 'completed' && (summary.classify || 0) >= 50) break;
    } catch (err) {
      // continue
    }
  }
  return {
    ...c,
    slug: best?.slug || 'unknown',
    result: best?.summary || { status: 'error', stage: 'n/a' },
    tried,
  };
}

async function main() {
  console.log(`Running ${CASES.length} extended cases…\n`);
  const rows = [];
  let i = 0;
  for (const c of CASES) {
    i += 1;
    process.stdout.write(`[${i}/${CASES.length}] ${c.label} … `);
    try {
      const row = await runOne(c);
      rows.push(row);
      const r = row.result;
      const mark =
        r.status === 'completed' ? 'PASS' : r.status === 'stopped' ? 'STOP' : 'FAIL';
      console.log(
        `${mark} slug=${row.slug} stage=${r.stage} ocr=${r.ocr ?? '-'} cls=${r.classify ?? '-'} ext=${r.extract ?? '-'}${
          r.stopReason ? ` | ${r.stopReason}` : ''
        }`
      );
    } catch (err) {
      rows.push({ ...c, result: { status: 'error', stage: 'error', stopReason: err.message } });
      console.log(`ERROR ${err.message}`);
    }
  }

  const byGroup = {};
  for (const r of rows) {
    byGroup[r.group] = byGroup[r.group] || { completed: 0, stopped: 0, error: 0, total: 0 };
    byGroup[r.group].total += 1;
    const s = r.result.status;
    if (s === 'completed') byGroup[r.group].completed += 1;
    else if (s === 'stopped') byGroup[r.group].stopped += 1;
    else byGroup[r.group].error += 1;
  }

  const outPath = path.join(ROOT, 'temp/extended-live-results.json');
  fs.writeFileSync(outPath, JSON.stringify({ byGroup, rows }, null, 2));

  console.log('\n=== Summary by group ===');
  for (const [g, s] of Object.entries(byGroup)) {
    console.log(
      `${g.padEnd(10)} completed=${s.completed} stopped=${s.stopped} error=${s.error} / ${s.total}`
    );
  }
  console.log(`\nWrote ${outPath}`);

  await terminateOcr();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await terminateOcr();
  } catch {
    // ignore
  }
  process.exit(1);
});

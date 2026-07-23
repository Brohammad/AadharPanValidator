#!/usr/bin/env node
/**
 * Batch-verify sample images and write a summary JSON.
 * Usage: node scripts/batch-verify.js
 */
const fs = require('fs');
const path = require('path');
const { verifyDocument } = require('../src/pipeline/orchestrator');
const { terminateOcr } = require('../src/ocr/tesseract');

const ASSETS = path.join(
  process.env.HOME,
  '.cursor/projects/Users-brohammad-projects-avioagent/assets'
);

const SAMPLES = [
  { id: 1, label: 'PAN - Warghude Arti', file: 'WhatsApp_Image_2026-07-23_at_22.34.05-e96c90ff-f52b-471a-8751-92b54e6a4aa7.png', expect: 'PAN' },
  { id: 2, label: 'PAN - Pinki Saha', file: 'WhatsApp_Image_2026-07-23_at_22.34.05__1_-982f353d-9d23-4ff6-b9a6-12566552af28.png', expect: 'PAN' },
  { id: 3, label: 'PAN - D Manikandan', file: 'WhatsApp_Image_2026-07-23_at_22.34.06-a83c2e57-5192-49ff-a27e-9331bcc76d6e.png', expect: 'PAN' },
  { id: 4, label: 'Aadhaar - Niranjan', file: 'WhatsApp_Image_2026-07-23_at_22.34.06__1_-4b88e997-879c-457d-8267-9c9683fda154.png', expect: 'AADHAAR' },
  { id: 5, label: 'Aadhaar - Subhash', file: 'WhatsApp_Image_2026-07-23_at_22.34.07-d8569b72-f426-45c7-98e2-dd314f13fd67.png', expect: 'AADHAAR' },
  { id: 6, label: 'FAKE Notes Aadhaar', file: 'image-45d0b61d-2c1b-418a-ab37-c3f80068db70.png', expect: 'FAKE' },
  { id: 7, label: 'FAKE Notes PAN', file: 'image-65edf19b-4a65-49a4-a95c-16c5fc55e610.png', expect: 'FAKE' },
  { id: 8, label: 'Meeting Notes', file: 'image-d1e5c226-ba29-4db9-b183-2676e1015aed.png', expect: 'UNKNOWN' },
  { id: 9, label: 'FAKE John Doe', file: 'image-d70e0835-f70e-4818-8e1b-ea4d8345a7a3.png', expect: 'FAKE' },
  { id: 10, label: 'FAKE Random Person', file: 'image-dae049f3-4d6b-4ff4-ad80-69a6368b4cc5.png', expect: 'FAKE' },
  { id: 11, label: 'FAKE Alex + junk', file: path.resolve(__dirname, '../temp/alex-thomas-fake.png'), expect: 'FAKE', absolute: true },
  { id: 12, label: 'YOUR PAN', file: 'WhatsApp_Image_2026-07-23_at_22.56.19-05e3c4cc-62d7-48a6-9ecb-80e8071fa864.png', expect: 'PAN' },
  { id: 13, label: 'YOUR Aadhaar', file: 'WhatsApp_Image_2026-07-23_at_22.56.40-0a2d20d9-7b74-426b-bf3e-7ea02ea880c4.png', expect: 'AADHAAR' },
];

async function main() {
  const results = [];

  for (const sample of SAMPLES) {
    const filePath = sample.absolute ? sample.file : path.join(ASSETS, sample.file);
    if (!fs.existsSync(filePath)) {
      results.push({ id: sample.id, label: sample.label, error: 'file missing', path: filePath });
      console.log(`SKIP ${sample.id} ${sample.label} — missing`);
      continue;
    }

    const t0 = Date.now();
    try {
      const r = await verifyDocument(filePath, path.basename(filePath), `batch-${sample.id}`);
      const row = {
        id: sample.id,
        label: sample.label,
        expect: sample.expect,
        type: r.documentType,
        V: r.validation?.passed,
        A: r.authenticity?.passed,
        score: r.authenticity?.score,
        overall: r.overallPassed,
        ocr: r.ocrConfidence,
        extract: r.extractionConfidence,
        data: r.data,
        fraud: r.fraudIndicators || [],
        warnings: r.qualityWarnings || [],
        ms: Date.now() - t0,
      };
      results.push(row);
      console.log(
        `${sample.id.toString().padStart(2)} ${String(r.documentType).padEnd(8)} ` +
          `V=${r.validation?.passed} A=${r.authenticity?.passed} score=${r.authenticity?.score} ` +
          `ocr=${r.ocrConfidence} ${r.overallPassed ? 'PASS' : 'FAIL'} ` +
          `${row.ms}ms | ${sample.label} | name=${r.data?.name || '—'}`
      );
    } catch (err) {
      results.push({ id: sample.id, label: sample.label, error: err.message, ms: Date.now() - t0 });
      console.error(`ERR ${sample.id} ${sample.label}: ${err.message}`);
    }
  }

  const out = path.resolve(__dirname, '../temp/batch-results-prod.json');
  fs.writeFileSync(out, JSON.stringify(results, null, 2));
  console.log(`\nWrote ${out}`);

  // Summary expectations
  let ok = 0;
  for (const r of results) {
    if (r.error) continue;
    if (r.expect === 'FAKE' && r.overall === false) ok++;
    else if (r.expect === 'UNKNOWN' && (r.type === 'UNKNOWN' || r.overall === false)) ok++;
    else if ((r.expect === 'PAN' || r.expect === 'AADHAAR') && r.type === r.expect && r.overall) ok++;
  }
  console.log(`Expectation match: ${ok}/${results.filter((r) => !r.error).length}`);

  await terminateOcr();
}

main().catch(async (err) => {
  console.error(err);
  await terminateOcr();
  process.exit(1);
});

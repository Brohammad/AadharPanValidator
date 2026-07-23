#!/usr/bin/env node
/**
 * Generate OCR-friendly mock PDFs for extraction document types.
 * Usage: node scripts/generate-mocks.js
 */
const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const OUT_DIR = path.resolve(__dirname, '../assets/mocks');

async function writeTextPdf(filename, title, lines) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let y = 740;
  page.drawText(title, { x: 50, y, size: 16, font: bold, color: rgb(0.05, 0.1, 0.25) });
  y -= 36;

  for (const line of lines) {
    if (!line) {
      y -= 14;
      continue;
    }
    const isHeading = line.startsWith('## ');
    const text = isHeading ? line.slice(3) : line;
    const size = isHeading ? 13 : 11;
    const useFont = isHeading ? bold : font;
    const wrapped = wrap(text, isHeading ? 70 : 85);
    for (const part of wrapped) {
      if (y < 50) break;
      page.drawText(part, { x: 50, y, size, font: useFont, color: rgb(0, 0, 0) });
      y -= size + 6;
    }
  }

  const bytes = await pdf.save();
  const outPath = path.join(OUT_DIR, filename);
  fs.writeFileSync(outPath, bytes);
  console.log(`Wrote ${outPath}`);
  return outPath;
}

function wrap(text, maxChars) {
  if (text.length <= maxChars) return [text];
  const words = text.split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > maxChars && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  await writeTextPdf('mock-cin.pdf', 'CERTIFICATE OF INCORPORATION', [
    'Ministry of Corporate Affairs',
    'Registrar of Companies (ROC) Mumbai',
    '',
    '## Company Details',
    'CIN: U72900MH2018PTC312456',
    'Company Name: AVIO SECURITY SERVICES PRIVATE LIMITED',
    'Registration Number: 312456',
    'Date of Incorporation: 15/03/2018',
    'Registered Office: 401, Skyline Tower, Andheri East, Mumbai, Maharashtra 400069',
    'ROC: ROC Mumbai',
    'Company Status: Active',
    'Company Category: Company limited by shares',
    'Company Class: Private',
    'Authorized Capital: Rs. 1000000',
    'Paid-up Capital: Rs. 500000',
  ]);

  await writeTextPdf('mock-security-clearance.pdf', 'SECURITY CLEARANCE CERTIFICATE', [
    '## Clearance Details',
    'Clearance Number: SC-BOM-2024-00482',
    'Reference Number: BCAS/ASC/2024/1189',
    'Employee Name: RAHUL MEHTA',
    'Organization: AVIO SECURITY SERVICES PRIVATE LIMITED',
    'Department: Airport Operations',
    'Designation: Security Supervisor',
    'Clearance Type: Airport Entry Permit',
    'Clearance Level: Restricted Area Access',
    'Purpose: Duty at passenger screening checkpoint',
    'Valid From: 01/01/2024',
    'Valid Until: 31/12/2026',
    'Issuing Authority: Bureau of Civil Aviation Security',
    '',
    'Authorized Signature',
    'Official Stamp',
  ]);

  await writeTextPdf('mock-security-programme.pdf', 'AVIATION SECURITY PROGRAMME', [
    '## Document Control',
    'Organization: AVIO AIRPORT OPERATOR',
    'Programme Title: Airport Security Programme 2024',
    'Document Number: ASP-BOM-2024-01',
    'Version: 3.2',
    'Revision Number: 07',
    'Effective Date: 01/04/2024',
    'Review Date: 01/04/2025',
    'Prepared By: Ananya Sharma',
    'Reviewed By: Vikram Patel',
    'Approved By: Airport Director',
    'Classification: CONFIDENTIAL',
    '',
    '## 1. Introduction',
    'This Security Programme describes protective measures for airport operations.',
    '',
    '## 2. Access Control',
    '- Perimeter fencing and CCTV coverage',
    '- Staff identity verification at entry points',
    '- Visitor escort procedures',
    '',
    '## 3. Screening',
    '- Passenger and cabin baggage screening',
    '- Hold baggage reconciliation',
  ]);

  await writeTextPdf('mock-authority-letter.pdf', 'AUTHORITY LETTER', [
    'To Whom It May Concern',
    '',
    'Company Name: AVIO SECURITY SERVICES PRIVATE LIMITED',
    'Reference Number: ASL/2024/092',
    'Date: 12/06/2024',
    'To: Airport Operator / BCAS',
    '',
    'Authorized Signatory: PRIYA NAIR',
    'Designation: General Manager - Compliance',
    '',
    'We hereby authorize Priya Nair to sign on behalf of the company for all',
    'aviation security documentation and related submissions.',
    '',
    'Scope of Authority: Signing security programme amendments and clearance forms',
    'Validity: Valid From 12/06/2024 Valid Until 11/06/2025',
    'Contact: priya.nair@aviosecurity.example Phone: +91 98765 43210',
    '',
    'For M/s AVIO SECURITY SERVICES PRIVATE LIMITED',
    'Authorised Signatory',
    'Company Seal',
  ]);

  console.log('\nMock documents ready in assets/mocks/');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

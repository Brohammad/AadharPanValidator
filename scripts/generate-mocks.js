#!/usr/bin/env node
/**
 * Generate OCR-friendly mocks for the 4 extraction document types only:
 * CIN, Security Clearance, Security Programme, Authority Letter.
 *
 * Formats per sample: PDF, PNG, JPG
 * Usage: node scripts/generate-mocks.js
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { pdfToPng } = require('../src/preprocessing/poppler');

const OUT_DIR = path.resolve(__dirname, '../assets/mocks');

/** Only these four extraction types */
const DOCS = [
  {
    slug: 'cin',
    variants: [
      {
        id: 'cin',
        title: 'CERTIFICATE OF INCORPORATION',
        lines: [
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
        ],
      },
      {
        id: 'cin-2',
        title: 'CORPORATE IDENTITY NUMBER CERTIFICATE',
        lines: [
          'Ministry of Corporate Affairs',
          'ROC Delhi',
          '',
          '## Company Details',
          'Corporate Identity Number: L85110DL2020PLC401122',
          'Company Name: SKYLINE AVIATION LOGISTICS LIMITED',
          'Registration Number: 401122',
          'Date of Incorporation: 22/08/2020',
          'Registered Office: B-12, Connaught Place, New Delhi 110001',
          'ROC: ROC Delhi',
          'Company Status: Active',
          'Company Category: Public company',
          'Company Class: Limited',
          'Authorized Capital: Rs. 5000000',
          'Paid-up Capital: Rs. 2500000',
        ],
      },
    ],
  },
  {
    slug: 'security-clearance',
    variants: [
      {
        id: 'security-clearance',
        title: 'SECURITY CLEARANCE CERTIFICATE',
        lines: [
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
        ],
      },
      {
        id: 'security-clearance-2',
        title: 'CLEARANCE CERTIFICATE',
        lines: [
          '## Clearance Details',
          'Clearance Number: SC-DEL-2025-00901',
          'Reference Number: REF/BCAS/2025/77',
          'Employee Name: SNEHA KAPOOR',
          'Organization: INDIA GATE AVIATION PVT LTD',
          'Department: Terminal Security',
          'Designation: Senior Officer',
          'Clearance Type: Background Verification Clearance',
          'Clearance Level: Level 2',
          'Purpose: Airside operations duty',
          'Valid From: 15/02/2025',
          'Valid Until: 14/02/2027',
          'Issuing Authority: Airport Security Unit',
          '',
          'Authorized Signature',
          'Official Stamp',
        ],
      },
    ],
  },
  {
    slug: 'security-programme',
    variants: [
      {
        id: 'security-programme',
        title: 'AVIATION SECURITY PROGRAMME',
        lines: [
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
        ],
      },
      {
        id: 'security-programme-2',
        title: 'AIRPORT SECURITY PROGRAM',
        lines: [
          '## Document Control',
          'Organization: DELHI INTERNATIONAL AIRPORT',
          'Programme Title: Terminal Security Programme',
          'Document Number: DOC-ASP-DEL-09',
          'Version: 1.0',
          'Revision Number: 02',
          'Effective Date: 10/01/2025',
          'Review Date: 10/01/2026',
          'Prepared By: Meera Joshi',
          'Reviewed By: Arjun Desai',
          'Approved By: Chief Security Officer',
          'Classification: RESTRICTED',
          '',
          '## 1. Scope',
          'Covers landside and airside security controls.',
          '',
          '## 2. Contingency',
          '- Incident response checklist',
          '- Evacuation assembly points',
        ],
      },
    ],
  },
  {
    slug: 'authority-letter',
    variants: [
      {
        id: 'authority-letter',
        title: 'AUTHORITY LETTER',
        lines: [
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
        ],
      },
      {
        id: 'authority-letter-2',
        title: 'AUTHORITY TO SIGN',
        lines: [
          'To Whom It May Concern',
          '',
          'Company Name: SKYLINE AVIATION LOGISTICS LIMITED',
          'Reference Number: ASL-DEL-331',
          'Date: 05/03/2025',
          'To: Directorate of Aviation Security',
          '',
          'Authorized Person: AMIT VERMA',
          'Designation: Company Secretary',
          '',
          'We hereby authorise Amit Verma to sign on behalf of the company and submit',
          'all required aviation compliance documents.',
          '',
          'Scope of Authority: Authority to sign contracts and security filings',
          'Validity: Valid From 05/03/2025 Valid Until 04/03/2026',
          'Contact: amit.verma@skylineaviation.example Phone: +91 99887 76655',
          '',
          'For M/s SKYLINE AVIATION LOGISTICS LIMITED',
          'Company Seal',
        ],
      },
    ],
  },
];

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

async function buildPdfBytes(title, lines) {
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
    for (const part of wrap(text, isHeading ? 70 : 85)) {
      if (y < 50) break;
      page.drawText(part, { x: 50, y, size, font: useFont, color: rgb(0, 0, 0) });
      y -= size + 6;
    }
  }

  return Buffer.from(await pdf.save());
}

async function rasterizePdf(pdfPath, baseName) {
  const tmpPrefix = path.join(OUT_DIR, `.tmp-${baseName}`);
  await pdfToPng(pdfPath, tmpPrefix, 200);
  // pdftoppm -singlefile isn't exposed the same way; take first page if multi
  const candidates = [
    `${tmpPrefix}.png`,
    `${tmpPrefix}-1.png`,
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(`pdfToPng produced no PNG for ${pdfPath}`);
}

async function writeFormats(variant) {
  const pdfBytes = await buildPdfBytes(variant.title, variant.lines);
  const pdfPath = path.join(OUT_DIR, `${variant.id}.pdf`);
  fs.writeFileSync(pdfPath, pdfBytes);
  console.log(`Wrote ${pdfPath}`);

  const rasterPath = await rasterizePdf(pdfPath, variant.id);
  const pngPath = path.join(OUT_DIR, `${variant.id}.png`);
  const jpgPath = path.join(OUT_DIR, `${variant.id}.jpg`);

  await sharp(rasterPath).png().toFile(pngPath);
  await sharp(rasterPath).jpeg({ quality: 92 }).toFile(jpgPath);
  fs.unlinkSync(rasterPath);
  // clean leftover page-N files if any
  for (const f of fs.readdirSync(OUT_DIR)) {
    if (f.startsWith(`.tmp-${variant.id}`) && f.endsWith('.png')) {
      try {
        fs.unlinkSync(path.join(OUT_DIR, f));
      } catch {
        // ignore
      }
    }
  }

  console.log(`Wrote ${pngPath}`);
  console.log(`Wrote ${jpgPath}`);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Fresh start: only keep the 4 extraction types we regenerate
  for (const name of fs.readdirSync(OUT_DIR)) {
    fs.unlinkSync(path.join(OUT_DIR, name));
  }

  for (const doc of DOCS) {
    for (const variant of doc.variants) {
      await writeFormats(variant);
    }
  }

  const files = fs.readdirSync(OUT_DIR).sort();
  console.log(`\n${files.length} mock files in assets/mocks/ (4 types × 2 variants × pdf/png/jpg)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

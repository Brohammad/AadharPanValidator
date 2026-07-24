# AI Document Verification System

Offline Node.js service for verifying **Aadhaar** and **PAN** documents, and extracting fields from **Passport**, **CIN**, **Security Clearance**, **Security Programme**, and **Authority Signatory Letter** documents.

Document type is **selected by the caller** (UI dropdown or API slug) — there is no auto-detection of type across endpoints.

---

## Table of contents

1. [What it does](#what-it-does)
2. [Prerequisites](#prerequisites)
3. [Install and run](#install-and-run)
4. [Use the web UI](#use-the-web-ui)
5. [API reference](#api-reference)
6. [Mock documents and tests](#mock-documents-and-tests)
7. [Configuration](#configuration)
8. [Project layout](#project-layout)
9. [Pipeline overview](#pipeline-overview)
10. [Adding a document type](#adding-a-document-type)
11. [Troubleshooting](#troubleshooting)

---

## What it does

| Document | Mode | What you get |
|----------|------|----------------|
| Aadhaar | Verification | Field extract + checksum validation + integrity / risk indicators |
| PAN | Verification | Field extract + PAN format checks + integrity / risk indicators |
| Passport | Extraction | Structured fields + MRZ / date validation |
| CIN | Extraction | CIN number, company name, ROC, capital, + CIN format validation |
| Security Clearance | Extraction | Employee, clearance type/level, validity, issuer, … |
| Security Programme | Extraction | Programme title, version, approvals, sections, … |
| Authority Letter | Extraction | Authorized person, company, scope, validity, contacts, … |

**Supported uploads:** `.jpg`, `.jpeg`, `.png`, `.pdf` (max size configurable; default 10 MB).

---

## Prerequisites

| Requirement | Notes |
|-------------|--------|
| **Node.js 20+** | `node -v` (required by `node-poppler`) |
| **npm** | Comes with Node |
| **Poppler** | Windows: bundled via npm (`node-poppler-win32`). macOS/Linux: install system Poppler for PDF support |

### Poppler (PDF support)

| OS | What to do |
|----|------------|
| **Windows** | Nothing extra — `npm install` pulls Poppler binaries automatically |
| **macOS** | `brew install poppler` |
| **Ubuntu / Debian** | `sudo apt install poppler-utils` |

JPG/PNG uploads work without Poppler. PDF uploads need Poppler (bundled on Windows, system install on Mac/Linux).

Verify (optional):

```bash
# After npm install — Windows uses the bundled binary via the app
# On Mac/Linux you can also check:
pdftoppm -v
```

No GraphicsMagick / ImageMagick required.

---

## Install and run

From the project root:

```bash
# 1. Install dependencies (on Windows this also installs Poppler binaries)
npm install

# 2. Create local config (optional but recommended)
# macOS / Linux:
cp .env.example .env
# Windows (PowerShell / CMD):
copy .env.example .env

# 3. Start the server
npm start
```

**Windows one-liner path:** Node 20+ → `git clone` → `npm install` → `npm start` → open http://localhost:3000  
No separate Poppler install needed for PDFs on Windows.

You should see logs like:

```text
Document verification server running on http://localhost:3000
OCR workers warmed up
```

Open **http://localhost:3000** in a browser.

### Dev mode (auto-restart on file changes)

```bash
npm run dev
```

### npm scripts

| Script | Command | Purpose |
|--------|---------|---------|
| `npm start` | `node src/server.js` | Run production-style server |
| `npm run dev` | `node --watch src/server.js` | Restart on code changes |
| `npm run mocks` | `node scripts/generate-mocks.js` | Regenerate extraction mock PDFs/PNG/JPG |
| `npm run fixtures` | `node scripts/generate-fixtures.js` | Build blur/rotate/screenshot fixture variants |
| `npm test` | unit + regression smoke | CI-friendly automated tests |
| `npm run test:unit` | `node --test test/**/*.test.js` | Validator / pipeline unit tests |
| `npm run test:extract` | `node scripts/batch-extract.js` | Full OCR regression on 24 mocks |
| `npm run batch` | `node scripts/batch-verify.js` | Batch-verify sample Aadhaar/PAN images (if present) |

Default port is **3000**. Change with `PORT=4000 npm start` or edit `.env`.

---

## Use the web UI

1. Start the server (`npm start`).
2. Open [http://localhost:3000](http://localhost:3000).
3. Choose a **document type** from the dropdown (loaded from `GET /api/documents`).
4. Upload a JPG / PNG / PDF of that document.
5. Review the result panel: pipeline stage, OCR confidence, extracted `data`, issues, timings.

**Important:** pick the type that matches the file. Uploading a CIN PDF while `pan` is selected will fail the type-fit gate.

### Quick try with built-in mocks

Mocks for the four extraction types live in `assets/mocks/` (PDF, PNG, JPG):

```text
assets/mocks/cin.pdf
assets/mocks/security-clearance.png
assets/mocks/security-programme.jpg
assets/mocks/authority-letter.pdf
…
```

In the UI, select the matching type and upload any of those files.

---

## API reference

### List document types

```bash
curl http://localhost:3000/api/documents
```

Example shape:

```json
{
  "documents": [
    {
      "type": "CIN",
      "slug": "cin",
      "label": "CIN Document",
      "mode": "extraction",
      "endpoint": "/api/cin"
    }
  ]
}
```

### Upload and process

`POST /api/{slug}` with `multipart/form-data` and field name **`document`**.

| Slug | Mode | Endpoint |
|------|------|----------|
| `aadhaar` | verification | `POST /api/aadhaar` |
| `pan` | verification | `POST /api/pan` |
| `passport` | extraction | `POST /api/passport` |
| `cin` | extraction | `POST /api/cin` |
| `security-clearance` | extraction | `POST /api/security-clearance` |
| `security-programme` | extraction | `POST /api/security-programme` |
| `authority-letter` | extraction | `POST /api/authority-letter` |

#### Examples

```bash
# Extraction — CIN
curl -X POST http://localhost:3000/api/cin \
  -F "document=@assets/mocks/cin.pdf"

# Extraction — Security Clearance (PNG)
curl -X POST http://localhost:3000/api/security-clearance \
  -F "document=@assets/mocks/security-clearance.png"

# Extraction — Authority Letter (JPG)
curl -X POST http://localhost:3000/api/authority-letter \
  -F "document=@assets/mocks/authority-letter.jpg"

# Verification — Aadhaar / PAN (use your own scans)
curl -X POST http://localhost:3000/api/aadhaar \
  -F "document=@/path/to/aadhaar.jpg"

curl -X POST http://localhost:3000/api/pan \
  -F "document=@/path/to/pan.jpg"
```

### Verification response (Aadhaar / PAN)

```json
{
  "stage": "complete",
  "status": "completed",
  "mode": "verification",
  "documentType": "AADHAAR",
  "validation": { "passed": true, "checks": { "checksum": true }, "reasons": [] },
  "riskAssessment": {
    "overallScore": 64,
    "threshold": 70,
    "passed": false,
    "indicators": ["…"],
    "reasoning": [{ "code": "RISK_ABOVE_THRESHOLD", "message": "…" }]
  },
  "authenticity": { "passed": false, "score": 64, "threshold": 70 },
  "overallPassed": false,
  "extractionConfidence": 72,
  "extractionReasons": [],
  "data": { "name": "...", "aadhaar": "..." },
  "fullOcrText": "...",
  "timings": { "total": 461 }
}
```

`riskAssessment` is a **heuristic integrity score** (not an official authenticity verdict). `authenticity` is kept as a deprecated mirror for compatibility.

### Extraction response (Passport, CIN, clearance, programme, authority letter)

```json
{
  "stage": "complete",
  "status": "completed",
  "mode": "extraction",
  "documentType": "CIN",
  "ocrConfidence": 96,
  "extractionConfidence": 93,
  "extractionReasons": [{ "code": "MANDATORY_FIELDS_COMPLETE", "message": "…" }],
  "extractionIssues": [],
  "validation": { "passed": true, "checks": { "format": true } },
  "riskAssessment": null,
  "data": {
    "cinNumber": "U72900MH2018PTC312456",
    "companyName": "AVIO SECURITY SERVICES PRIVATE LIMITED"
  },
  "fullOcrText": "...",
  "timings": { "total": 1000 }
}
```

### Early stop

If OCR or type-fit fails gates, the API returns early:

```json
{
  "stage": "ocr",
  "status": "stopped",
  "stopReason": "OCR quality below configured threshold",
  "reason": "OCR quality below configured threshold",
  "ocrConfidence": 24,
  "mode": "extraction",
  "reasons": [{ "code": "OCR_CONFIDENCE_LOW", "message": "OCR confidence 24% below threshold 40%" }]
}
```
---

## Mock documents and tests

### Generate mocks (4 extraction types only)

Creates fresh PDF / PNG / JPG samples under `assets/mocks/`:

- CIN (`cin`, `cin-2`)
- Security Clearance (`security-clearance`, `security-clearance-2`)
- Security Programme (`security-programme`, `security-programme-2`)
- Authority Letter (`authority-letter`, `authority-letter-2`)

```bash
npm run mocks
```

Requires `pdftoppm` (Poppler) so PDF pages can be rasterized to PNG/JPG.

### Generate degraded fixtures

Builds blurry / rotated / screenshot-like variants under `assets/fixtures/` (synthetic only):

```bash
npm run fixtures
```

### Automated tests

```bash
npm test                 # unit + regression smoke
npm run test:unit        # validators, OCR gate, classify, response shapes
npm run test:extract     # full OCR pipeline on 24 mocks
npm run test:regression  # smoke checks for gates + fixture presence
```

On success for extraction:

```text
24/24 passed
  pdf: 8/8
  png: 8/8
  jpg: 8/8
```

Results JSON is written to `temp/batch-extract-results.json`.

### Aadhaar / PAN batch (optional)

```bash
npm run batch
```

Uses sample images configured in `scripts/batch-verify.js` (paths may point at local asset folders). Skip this if those samples are not present.

---

## Configuration

Copy `.env.example` → `.env` and adjust as needed.

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3000` | HTTP port |
| `MAX_FILE_SIZE` / `MAX_UPLOAD_SIZE` | `10485760` | Upload limit (bytes) |
| `OCR_CONFIDENCE_THRESHOLD` | `40` | Min OCR confidence to continue |
| `CLASSIFICATION_THRESHOLD` | `35` | Min type-fit score for requested document |
| `CLASSIFICATION_MISMATCH_MARGIN` | `15` | Reject if another type scores this much higher |
| `EXTRACTION_THRESHOLD` | `45` | Soft warn when extraction confidence is low |
| `RISK_THRESHOLD` | `70` | Integrity / risk pass mark (verification) |
| `AUTH_SCORE_THRESHOLD` | `70` | Deprecated alias for `RISK_THRESHOLD` |
| `OCR_BLUR_MIN` | `40` | Soft blur floor used with OCR quality |
| `OCR_MIN_ALNUM` | `25` | Min alphanumeric characters in OCR text |
| `OCR_RESIZE_WIDTH_PHOTO` | `1800` | Photo preprocess resize target |
| `OCR_RESIZE_WIDTH_PDF` | `1600` | PDF/embedded resize target |
| `PDF_DPI` | `200` | Poppler rasterization DPI |
| `OCR_GOOD_ENOUGH_SCORE` | `140` | Tesseract early-stop score |
| `OCR_FAST_GOOD_ENOUGH_SCORE` | `80` | Fast-path early-stop score |
| `UPLOAD_DIR` | `uploads` | Multipart upload directory |
| `TEMP_DIR` | `temp` | Working / result temp files |
| `LOG_LEVEL` | `info` | Pino log level |

---

## Project layout

```text
avioagent/
├── assets/
│   ├── mocks/              # Generated PDF/PNG/JPG fixtures (extraction types)
│   └── fixtures/           # Degraded variants (blur/rotate/screenshot)
├── public/                 # Static HTML/JS/CSS UI
├── scripts/
│   ├── generate-mocks.js   # Build extraction mocks
│   ├── generate-fixtures.js
│   ├── batch-extract.js    # Test extraction mocks
│   ├── batch-regression.js
│   └── batch-verify.js     # Optional Aadhaar/PAN batch
├── test/                   # node:test unit tests
├── src/
│   ├── server.js           # Entry point
│   ├── app.js              # Express app
│   ├── config/             # Env + per-document keyword/label config
│   ├── controllers/        # HTTP handlers
│   ├── documents/          # One plugin per document type + registry
│   ├── pipeline/           # Orchestrator, stages, classify, OCR quality, response
│   ├── preprocessing/      # Modular stages + PDF prepare
│   ├── ocr/                # Tesseract workers
│   ├── rules/              # Risk / integrity detectors (verification)
│   ├── validators/         # Aadhaar, PAN, CIN, passport, dates
│   └── shared/             # Shared field extractors
├── .env.example
├── package.json
└── README.md
```

---

## Pipeline overview

```text
Upload → File validation → Prepare pages → Preprocess stages → OCR
  → OCR quality gate → Classification (type-fit) → Extract
  → Validate* → Risk assessment** → Response
```

\* Validation runs for plugins with `supportsValidation` (Aadhaar, PAN, Passport, CIN, and date-checked extraction docs).
\*\* Risk assessment (integrity indicators) runs for **verification** plugins only. It does **not** prove a document is officially genuine.

Architecture:

```text
POST /api/{slug}
  → Controller resolves document module from registry
  → preparePages → preprocess → OCR → OCR quality gate (may stop)
  → Classification type-fit gate (may stop as UNKNOWN)
  → document.extract() + extraction confidence reasons
  → validate (if supported) + riskChecks (verification)
  → Response builder (stage / status / reasons / riskAssessment)
```

---

## Adding a document type

1. Add identify/label config in `src/config/documents.js` (optional).
2. Create `src/documents/<name>Document.js` extending `BaseDocument` (`mode: 'verification'` or `'extraction'`; set `supportsValidation: true` when implementing `validate()`).
3. Implement `identify`, `extract`, and optionally `validate` / `riskChecks` / `refineOcr`.
4. Register the class in `src/documents/registry.js` and add a slug in `TYPE_SLUGS`.
5. Endpoint is available as `POST /api/{slug}` with no core pipeline changes.

Reuse helpers under `src/shared/` and `src/validators/` (labeled fields, dates, regex, MRZ, CIN, tables, presence, …).

---

## Troubleshooting

| Problem | What to check |
|---------|----------------|
| `pdftoppm: command not found` / PDF fails | **Windows:** re-run `npm install`. **macOS:** `brew install poppler`. **Linux:** `sudo apt install poppler-utils` |
| PDF uploads fail | Confirm `pdftoppm -v` works; check server logs |
| First request is slow | Normal until OCR workers warm; server warms them on boot |
| `Classification confidence below threshold` | Wrong document type selected, or image too blurry / cropped |
| `OCR quality below configured threshold` | Retake photo, higher resolution, better lighting; or lower `OCR_CONFIDENCE_THRESHOLD` for experiments |
| Port already in use | `PORT=3001 npm start` |
| `npm run test:extract` fails | Run `npm run mocks` first; ensure Poppler is installed |
| Empty / wrong fields | Check `fullOcrText` in the response — if OCR is wrong, extraction cannot recover |

---

## Disclaimer

Heuristic OCR and document-integrity analysis only — not legal proof of document originality, official authenticity, or identity. `riskAssessment` scores are advisory indicators for downstream systems.

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
| Aadhaar | Verification | Field extract + checksum validation + authenticity / fraud signals |
| PAN | Verification | Field extract + PAN format checks + authenticity / fraud signals |
| Passport | Extraction | Structured fields (number, name, dates, MRZ cues, …) |
| CIN | Extraction | CIN number, company name, ROC, capital, … |
| Security Clearance | Extraction | Employee, clearance type/level, validity, issuer, … |
| Security Programme | Extraction | Programme title, version, approvals, sections, … |
| Authority Letter | Extraction | Authorized person, company, scope, validity, contacts, … |

**Supported uploads:** `.jpg`, `.jpeg`, `.png`, `.pdf` (max size configurable; default 10 MB).

---

## Prerequisites

| Requirement | Notes |
|-------------|--------|
| **Node.js 18+** | `node -v` |
| **npm** | Comes with Node |
| **Poppler** | Provides `pdftoppm` for PDF → image |

### Install Poppler

```bash
# macOS
brew install poppler

# Ubuntu / Debian
sudo apt install poppler-utils

# Verify
pdftoppm -v
```

No GraphicsMagick / ImageMagick required.

---

## Install and run

From the project root:

```bash
# 1. Install dependencies
npm install

# 2. Create local config (optional but recommended)
cp .env.example .env

# 3. Start the server
npm start
```

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
| `npm run test:extract` | `node scripts/batch-extract.js` | Test the 4 extraction types across formats |
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
  "mode": "verification",
  "documentType": "AADHAAR",
  "validation": { "passed": true, "checks": { "checksum": true } },
  "authenticity": { "passed": false, "score": 64, "threshold": 70 },
  "overallPassed": false,
  "data": { "name": "...", "aadhaar": "..." },
  "fullOcrText": "...",
  "timings": { "total": 461 }
}
```

### Extraction response (Passport, CIN, clearance, programme, authority letter)

```json
{
  "mode": "extraction",
  "documentType": "CIN",
  "ocrConfidence": 96,
  "extractionConfidence": 93,
  "extractionIssues": [],
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
  "reason": "OCR quality below configured threshold",
  "ocrConfidence": 24,
  "reasons": ["OCR confidence 24% below threshold 40%"]
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

### Run extraction tests

Runs the pipeline against all 24 mock files (4 types × 2 variants × 3 formats) and checks key fields:

```bash
npm run test:extract
```

On success:

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
| `MAX_FILE_SIZE` | `10485760` | Upload limit (bytes) |
| `OCR_CONFIDENCE_THRESHOLD` | `40` | Min OCR confidence to continue |
| `CLASSIFICATION_THRESHOLD` | `35` | Min type-fit score for requested document |
| `CLASSIFICATION_MISMATCH_MARGIN` | `15` | Reject if another type scores this much higher |
| `AUTH_SCORE_THRESHOLD` | `70` | Authenticity pass mark (verification mode) |
| `OCR_BLUR_MIN` | `40` | Soft blur floor used with OCR quality |
| `OCR_MIN_ALNUM` | `25` | Min alphanumeric characters in OCR text |
| `UPLOAD_DIR` | `uploads` | Multipart upload directory |
| `TEMP_DIR` | `temp` | Working / result temp files |
| `LOG_LEVEL` | `info` | Pino log level |

---

## Project layout

```text
avioagent/
├── assets/
│   └── mocks/              # Generated PDF/PNG/JPG fixtures (extraction types)
├── public/                 # Static HTML/JS/CSS UI
├── scripts/
│   ├── generate-mocks.js   # Build extraction mocks
│   ├── batch-extract.js    # Test extraction mocks
│   └── batch-verify.js     # Optional Aadhaar/PAN batch
├── src/
│   ├── server.js           # Entry point
│   ├── app.js              # Express app
│   ├── config/             # Env + per-document keyword/label config
│   ├── controllers/        # HTTP handlers
│   ├── documents/          # One plugin per document type + registry
│   ├── pipeline/           # Orchestrator, classify, OCR quality, response
│   ├── preprocessing/      # Crop, orientation, OCR variants, PDF
│   ├── ocr/                # Tesseract workers
│   ├── rules/              # Authenticity / fraud detectors (verification)
│   ├── validators/         # Aadhaar / PAN validators
│   └── shared/             # Shared field extractors
├── .env.example
├── package.json
└── README.md
```

---

## Pipeline overview

```text
Upload → Preprocess → OCR → OCR quality gate
  → Classification confidence (type-fit for requested endpoint)
  → Extract → Validate* → Authenticity* → Response
```

\* Validation and authenticity run only for **verification** plugins (Aadhaar, PAN). Extraction-only types skip them.

Architecture:

```text
POST /api/{slug}
  → Controller resolves document module from registry
  → Preprocess → OCR → OCR quality gate (may stop)
  → Classification type-fit gate (may stop as UNKNOWN)
  → document.extract()
  → [verification only] validate + authenticity rule engine
  → Response builder (stage / status / reasons)
```

---

## Adding a document type

1. Add identify/label config in `src/config/documents.js` (optional).
2. Create `src/documents/<name>Document.js` extending `BaseDocument` (`mode: 'verification'` or `'extraction'`).
3. Register the class in `src/documents/registry.js` and add a slug in `TYPE_SLUGS`.
4. Endpoint is available as `POST /api/{slug}` with no route file changes.

Reuse helpers under `src/shared/` (labeled fields, dates, regex, MRZ, tables, presence, …).

---

## Troubleshooting

| Problem | What to check |
|---------|----------------|
| `pdftoppm: command not found` | Install Poppler (`brew install poppler` / `apt install poppler-utils`) |
| PDF uploads fail | Confirm `pdftoppm -v` works; check server logs |
| First request is slow | Normal until OCR workers warm; server warms them on boot |
| `Classification confidence below threshold` | Wrong document type selected, or image too blurry / cropped |
| `OCR quality below configured threshold` | Retake photo, higher resolution, better lighting; or lower `OCR_CONFIDENCE_THRESHOLD` for experiments |
| Port already in use | `PORT=3001 npm start` |
| `npm run test:extract` fails | Run `npm run mocks` first; ensure Poppler is installed |
| Empty / wrong fields | Check `fullOcrText` in the response — if OCR is wrong, extraction cannot recover |

---

## Disclaimer

Heuristic OCR analysis only — not legal proof of document originality or identity.

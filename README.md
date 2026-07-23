# AI Document Verification System

Offline Node.js service for verifying **Aadhaar** and **PAN** documents, and extracting fields from **Passport**, **CIN**, **Security Clearance**, **Security Programme**, and **Authority Signatory Letter** documents.

Document type is **selected by the caller** via a dedicated endpoint — there is no auto-classification.

## Features

- JPG, JPEG, PNG, and PDF upload support
- Persistent Tesseract OCR workers (`tesseract.js`, English)
- Card-region crop + orientation probes + OCR variants
- Image quality analysis via Sharp
- Plug-in document registry (lookup by type / URL slug)
- **Verification mode** (Aadhaar / PAN): validation + authenticity + fraud indicators
- **Extraction mode** (Passport, CIN, Security Clearance, Security Programme, Authority Letter): structured fields only
- Shared generic extractors (names, orgs, dates, emails, phones, tables, signature/stamp, full OCR text)
- Simple HTML frontend with document-type selector

## Prerequisites

- **Node.js** 18+
- **Poppler** (for PDF → PNG via `pdftoppm`)

```bash
# macOS
brew install poppler

# Ubuntu/Debian
sudo apt install poppler-utils
```

PDF uploads no longer need GraphicsMagick/ImageMagick.

## Setup

```bash
npm install
cp .env.example .env
npm start
```

Open [http://localhost:3000](http://localhost:3000)

## API

### `GET /api/documents`

Lists supported types, modes, and endpoints.

```json
{
  "documents": [
    { "type": "PASSPORT", "slug": "passport", "label": "Passport", "mode": "extraction", "endpoint": "/api/passport" }
  ]
}
```

### Per-type upload

`POST /api/{slug}` with `multipart/form-data` field **`document`**.

| Slug | Mode | Endpoint |
|------|------|----------|
| `aadhaar` | verification | `POST /api/aadhaar` |
| `pan` | verification | `POST /api/pan` |
| `passport` | extraction | `POST /api/passport` |
| `cin` | extraction | `POST /api/cin` |
| `security-clearance` | extraction | `POST /api/security-clearance` |
| `security-programme` | extraction | `POST /api/security-programme` |
| `authority-letter` | extraction | `POST /api/authority-letter` |

```bash
curl -X POST http://localhost:3000/api/passport \
  -F "document=@/path/to/passport.jpg"

curl -X POST http://localhost:3000/api/aadhaar \
  -F "document=@/path/to/aadhaar.jpg"
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

### Extraction response (Passport, CIN, etc.)

```json
{
  "mode": "extraction",
  "documentType": "PASSPORT",
  "ocrConfidence": 85,
  "extractionConfidence": 90,
  "extractionIssues": [],
  "data": { "passportNumber": "U5544054", "surname": "ANZAR", "givenName": "AABID MOHAMED" },
  "fullOcrText": "...",
  "timings": { "total": 520 }
}
```

## Pipeline decision gates

Processing stops early when quality is too low:

```
Upload → Preprocess → OCR → OCR quality gate
  → Classification confidence (type-fit for requested endpoint)
  → Extract → Validate* → Authenticity* → Response
```

\* Validation and authenticity run only for **verification** plugins (Aadhaar, PAN). Extraction-only types skip them.

Early-stop responses include `stage`, `status: "stopped"`, `reason`, OCR text, and explainable `reasons`.

### Configurable thresholds (`.env`)

| Variable | Default | Purpose |
|----------|---------|---------|
| `OCR_CONFIDENCE_THRESHOLD` | `40` | Min OCR confidence to continue |
| `CLASSIFICATION_THRESHOLD` | `20` | Min type-fit score for requested document |
| `AUTH_SCORE_THRESHOLD` | `70` | Authenticity pass threshold |
| `OCR_BLUR_MIN` | `40` | Soft blur floor (with low OCR) |
| `OCR_MIN_ALNUM` | `25` | Min alphanumeric chars in OCR text |
| `MAX_FILE_SIZE` | `10485760` | Upload size limit (bytes) |

Stopped OCR example:

```json
{
  "stage": "ocr",
  "status": "stopped",
  "reason": "OCR quality below configured threshold",
  "ocrConfidence": 24,
  "reasons": ["OCR confidence 24% below threshold 40%"]
}
```

## Architecture

```
POST /api/{slug}
  → Controller resolves document module from registry
  → Preprocess → OCR → OCR quality gate (may stop)
  → Classification type-fit gate (may stop as UNKNOWN)
  → document.extract()
  → [verification only] validate + authenticity rule engine
  → Response builder (stage / status / reasons)
```

## Adding a New Document Type

1. Add config in `src/config/documents.js` (optional)
2. Create `src/documents/<name>Document.js` extending `BaseDocument`
3. Register in `src/documents/registry.js` and add a URL slug in `TYPE_SLUGS`
4. New endpoint is available immediately as `POST /api/{slug}`

Reuse helpers under `src/shared/`.

## Batch test

```bash
npm run batch
```

## Disclaimer

Heuristic OCR analysis only — not legal proof of document originality.

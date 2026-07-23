# AI Document Verification System

Offline Node.js service for verifying **Aadhaar** and **PAN** documents from uploaded images or PDFs.

## Features

- JPG, JPEG, PNG, and PDF upload support
- Persistent Tesseract OCR workers (`tesseract.js`, English) with early-exit multi-pass recognition
- Card-region crop + orientation probes + invert/blue-channel variants for hard phone/CamScanner photos
- Image quality analysis (blur, brightness, contrast, noise, skew) via Sharp
- Document registry with plug-in architecture for future document types
- Rule-engine authenticity scoring with **fraud indicators** vs **quality warnings**
- Separate **validation** (format/checksum) vs **authenticity** (visual/fraud) decisions
- Structured JSON response with timings
- Simple HTML frontend for upload and results

## Prerequisites

- **Node.js** 18+
- **Poppler** (for PDF to image conversion)

```bash
# macOS
brew install poppler

# Ubuntu/Debian
sudo apt install poppler-utils
```

## Setup

```bash
npm install
cp .env.example .env
npm start
```

Open [http://localhost:3000](http://localhost:3000)

## API

### `POST /api/verify`

Upload a document as `multipart/form-data` with field name `document`.

```bash
curl -X POST http://localhost:3000/api/verify \
  -F "document=@/path/to/aadhaar.jpg"
```

### Response highlights

```json
{
  "documentType": "AADHAAR",
  "validation": { "passed": true, "checks": { "checksum": true } },
  "authenticity": { "passed": false, "score": 64, "threshold": 70 },
  "overallPassed": false,
  "ocrConfidence": 87,
  "extractionConfidence": 70,
  "fraudIndicators": ["Government emblem missing"],
  "qualityWarnings": [],
  "data": { "name": "...", "aadhaar": "..." },
  "timings": { "total": 461 }
}
```

Typed/notepad fakes with a valid checksum can pass **validation** while failing **authenticity**. Soft OCR/photo noise goes to `qualityWarnings`, not fraud, when authenticity still passes.

## Batch test

```bash
npm run batch
```

## Architecture

```
Upload → PDF/Image Prep → Card Crop → Orientation → OCR Variants
  → Feature Extraction → Document Registry → Field Extract → Validate
  → Rule Engine → Score Aggregator → Decision
```

Image analysis uses **Sharp** (no OpenCV WASM). OCR uses **Tesseract** with a reused worker pool.

## Adding a New Document Type

1. Create a class extending `BaseDocument` in `src/documents/`
2. Implement `identify()`, `extract()`, `validate()`, `authenticityChecks()`
3. Register in `src/documents/registry.js`

## Disclaimer

This system uses heuristic analysis and OCR. It provides confidence scores and fraud indicators — it does **not** claim legal proof of document originality. Always verify through official government channels when required.

const sharp = require('sharp');

async function extractFeatures(processedBuffer, ocrResult, imageQuality) {
  const metadata = await sharp(processedBuffer).metadata();
  const stats = await sharp(processedBuffer).stats();
  const text = ocrResult.text || '';
  const upperText = text.toUpperCase();

  const channels = stats.channels || [];
  const colorVariance =
    channels.length > 0
      ? channels.reduce((sum, ch) => sum + (ch.stdev || 0), 0) / channels.length
      : 0;

  const { data: pixelData, info } = await sharp(processedBuffer)
    .greyscale()
    .resize({ width: 400, withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });

  let edgeCount = 0;
  for (let i = 1; i < pixelData.length; i++) {
    if (Math.abs(pixelData[i] - pixelData[i - 1]) > 30) edgeCount++;
  }
  const edgeDensity = edgeCount / pixelData.length;

  // Center crop stats — ignore dark table/desk around the card
  const centerBuf = await sharp(processedBuffer)
    .extract({
      left: Math.floor((metadata.width || 100) * 0.15),
      top: Math.floor((metadata.height || 100) * 0.15),
      width: Math.max(10, Math.floor((metadata.width || 100) * 0.7)),
      height: Math.max(10, Math.floor((metadata.height || 100) * 0.7)),
    })
    .toBuffer();
  const centerStats = await sharp(centerBuf).stats();
  const centerChannels = centerStats.channels || [];
  const centerBrightness =
    centerChannels.length > 0
      ? centerChannels.reduce((sum, ch) => sum + ch.mean, 0) / centerChannels.length
      : imageQuality?.brightness ?? 128;

  // Detect large dark (QR-like) blocks and colorful photo-like regions on center
  const colorRaw = await sharp(centerBuf)
    .removeAlpha()
    .resize({ width: 200, withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });

  let darkBlocks = 0;
  let colorfulPixels = 0;
  const cw = colorRaw.info.width;
  const chh = colorRaw.info.height;
  const cd = colorRaw.data;
  for (let y = 0; y < chh; y += 4) {
    for (let x = 0; x < cw; x += 4) {
      const i = (y * cw + x) * 3;
      const r = cd[i];
      const g = cd[i + 1];
      const b = cd[i + 2];
      const avg = (r + g + b) / 3;
      const sat = Math.max(r, g, b) - Math.min(r, g, b);
      if (avg < 40) darkBlocks++;
      if (sat > 35 && avg > 35 && avg < 230) colorfulPixels++;
    }
  }
  const sampleCount = Math.ceil(chh / 4) * Math.ceil(cw / 4) || 1;
  const darkBlockRatio = darkBlocks / sampleCount;
  const photoRegionRatio = colorfulPixels / sampleCount;

  const brightness = centerBrightness;
  const isDarkUi = brightness < 85 && photoRegionRatio < 0.02;
  const isNearWhiteBg = brightness > 230 && colorVariance < 35;

  // QR-like: localized dark blocks on a light/medium card — not a dark UI theme
  const hasQrLikeRegion =
    !isDarkUi && darkBlockRatio > 0.03 && darkBlockRatio < 0.25;

  const aspectRatio = (metadata.width || 1) / (metadata.height || 1);

  const hasTimestampCue =
    /\b(?:JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)\b.*\b20\d{2}\b/i.test(
      text
    ) || /\bat\s+\d{1,2}:\d{2}\s*(AM|PM)?/i.test(text);

  const hasUiChrome =
    /MEETING\s*NOTES|COPY|CLIPBOARD|TODAY'?S\s*DISCUSSION|UNTITLED|NOTES/i.test(upperText);

  const hasExplicitFake = /FAKE\s*DOCUMENT|THIS\s*IS\s*A\s*FAKE/i.test(upperText);

  const hasJunkWords =
    /\b(APPLE|ORANGE|LAPTOP|BACKEND|FASTAPI|NODEJS|HELLO\s*THIS)\b/i.test(upperText);

  const hasCamScanner = /CAMSCANNER|SCANNED\s*BY/i.test(upperText);

  return {
    text,
    upperText,
    ocrConfidence: ocrResult.ocrConfidence,
    words: ocrResult.pages?.[0]?.words || ocrResult.words || [],
    lines: ocrResult.pages?.[0]?.lines || ocrResult.lines || [],
    imageQuality,
    metadata: {
      width: metadata.width,
      height: metadata.height,
      aspectRatio,
      format: metadata.format,
    },
    signals: {
      colorVariance,
      edgeDensity,
      darkBlockRatio,
      photoRegionRatio,
      isDarkUi,
      isNearWhiteBg,
      hasTimestampCue,
      hasUiChrome,
      hasExplicitFake,
      hasJunkWords,
      hasCamScanner,
      hasQrLikeRegion,
      hasPhotoLikeRegion: !isDarkUi && photoRegionRatio > 0.03,
      hasGovernmentOfIndia:
        /GOVERNMENT\s*OF\s*INDIA|GOVT\.?\s*OF\s*INDIA|भारत\s*सरकार/i.test(text),
      hasUidai: /UIDAI|UNIQUE\s*IDENTIFICATION|आधार|AADHAAR/i.test(text),
      hasIncomeTax: /INCOME\s*TAX|आयकर/i.test(text),
      hasPanLabel: /PERMANENT\s*ACCOUNT\s*NUMBER|\bPAN\b/i.test(upperText),
      hasAadhaarLabel: /AADHAAR|आधार/i.test(upperText),
      hasNotepadCues:
        /NOTEPAD|UNTITLED|LIBREOFFICE|MICROSOFT\s*WORD|\.DOCX|MEETING\s*NOTES/i.test(
          upperText
        ),
      hasScreenshotCues:
        /SCREENSHOT|SNIPPING\s*TOOL|SCREEN\s*CAPTURE|STATUS\s*BAR/i.test(upperText) ||
        hasTimestampCue ||
        isDarkUi,
      wordCount: text.split(/\s+/).filter(Boolean).length,
      lineCount: text.split('\n').filter((l) => l.trim()).length,
    },
  };
}

module.exports = { extractFeatures };

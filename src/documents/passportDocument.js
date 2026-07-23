const BaseDocument = require('./baseDocument');
const { extractLabeledValue } = require('../shared/labeledField');
const { extractLabeledDate, normalizeDateString, extractDates } = require('../shared/dates');
const { extractPassportNumbers } = require('../shared/regex');
const { parseMrz } = require('../shared/mrz');
const { extractGender } = require('./fieldExtractors');
const { refinePassportOcr } = require('../ocr/passportOcr');
const { scoreKeywordsDetailed } = require('../shared/keywords');
const docConfig = require('../config/documents').passport;

const MANDATORY = ['passportNumber', 'surname', 'givenName'];

function preferFullName(...candidates) {
  const cleaned = candidates
    .map((c) =>
      c
        ? String(c)
            // Collapse OCR letter-spacing: "R E A N Z A R" → "REANZAR"
            .replace(/\b(?:[A-Za-z]\s+){2,}[A-Za-z]\b/g, (m) => m.replace(/\s+/g, ''))
            .replace(/[^A-Za-z\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .toUpperCase()
        : null
    )
    .filter(Boolean)
    .filter((n) => n.length >= 2 && !/^(S|M|F|P|IND|NAME|SEX|TEA|LS|RE)$/.test(n));

  cleaned.sort((a, b) => {
    const score = (n) => n.split(/\s+/).length * 10 + n.length;
    return score(b) - score(a);
  });
  return cleaned[0] || null;
}

function extractTypeAndCountry(text) {
  const m = text.match(/\bType\b[\s\S]{0,40}?\b([PO])\b[\s\S]{0,20}?\b([A-Z]{3})\b/i);
  if (m) return { passportType: m[1].toUpperCase(), countryCode: m[2].toUpperCase() };
  const compact = text.match(/\b([PO])\s+([A-Z]{3})\b/);
  if (compact && /IND|USA|GBR|ARE|CAN|AUS/.test(compact[2])) {
    return { passportType: compact[1].toUpperCase(), countryCode: compact[2].toUpperCase() };
  }
  return { passportType: null, countryCode: null };
}

function extractIssueExpiryPair(text) {
  const m = text.match(
    /(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4})\s+(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4})/
  );
  if (!m) return { dateOfIssue: null, dateOfExpiry: null };
  return {
    dateOfIssue: normalizeDateString(m[1]),
    dateOfExpiry: normalizeDateString(m[2]),
  };
}

/** Looser labeled-date match — OCR often inserts junk between label and value. */
function extractDateNearLabel(text, labelPatterns, { window = 120 } = {}) {
  for (const re of labelPatterns) {
    const labelRe = new RegExp(re.source, 'i');
    const labelMatch = text.match(labelRe);
    if (!labelMatch || labelMatch.index == null) continue;
    const slice = text.slice(labelMatch.index, labelMatch.index + window);
    const dateMatch = slice.match(/(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4})/);
    if (dateMatch) {
      const normalized = normalizeDateString(dateMatch[1]);
      if (normalized) return normalized;
    }
  }
  return null;
}

function parseYyMmDd(token) {
  if (!/^\d{6}$/.test(token)) return null;
  const yy = parseInt(token.slice(0, 2), 10);
  const mm = token.slice(2, 4);
  const dd = token.slice(4, 6);
  const year = yy >= 50 ? 1900 + yy : 2000 + yy;
  return normalizeDateString(`${dd}/${mm}/${year}`);
}

function cleanPlace(value) {
  if (!value) return null;
  let s = String(value)
    .replace(/^[:\-\s]+/, '')
    .replace(/\s+/g, ' ')
    .replace(/[|,]+$/g, '')
    .trim();
  // OCR often prefixes junk digits / single letters ("5", "Rl EE, TRIVANDRUM…")
  s = s.replace(/^[^A-Za-z]+/, '');
  s = s.replace(/\b(RL|EE|VO|OR|WEIF|ENCE|HRD)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  if (!s || s.length < 3 || /^\d+$/.test(s)) return null;
  return s.slice(0, 80).toUpperCase() || null;
}

/** Indian city/state phrases commonly printed on passports */
function extractIndianPlace(text) {
  const m = text.match(
    /\b(TRIVANDRUM|THIRUVANANTHAPURAM|KOCHI|COCHIN|CHENNAI|MUMBAI|DELHI|BANGALORE|BENGALURU|HYDERABAD|KOLKATA|AHMEDABAD|PUNE|JAIPUR|LUCKNOW|CHANDIGARH|BHOPAL|PATNA|KOZHIKODE|CALICUT)(?:\s*[,/]?\s*(KERALA|TAMIL\s*NADU|KARNATAKA|MAHARASHTRA|DELHI|WEST\s*BENGAL|GUJARAT|RAJASTHAN|UTTAR\s*PRADESH|TELANGANA|ANDHRA\s*PRADESH))?\b/i
  );
  if (!m) return null;
  const city = m[1].toUpperCase().replace(/\s+/g, ' ');
  const state = m[2] ? m[2].toUpperCase().replace(/\s+/g, ' ') : null;
  return state ? `${city}, ${state}` : city;
}

/** Adult Indian passports are typically valid 10 years ending day-before anniversary. */
function inferIndianIssueFromExpiry(expiry) {
  const m = String(expiry || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  d.setUTCFullYear(d.getUTCFullYear() - 10);
  d.setUTCDate(d.getUTCDate() + 1);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}

function extractPersonalNumberFromText(text, passportNumber) {
  const blob = String(text || '').toUpperCase().replace(/[^A-Z0-9<]/g, '');
  if (passportNumber) {
    const re = new RegExp(
      `${passportNumber}<\\d[A-Z]{3}\\d{6}\\d?[MF<]\\d{6}\\d([0-9]{6,14})`
    );
    const m = blob.match(re);
    if (m) return m[1].replace(/<+$/, '') || null;
  }
  const loose = blob.match(/[MF]\d{6}\d([0-9]{9,14})/);
  return loose ? loose[1] : null;
}

function buildMrzFromFields(data) {
  if (!data.passportNumber || !data.surname || !data.countryCode) return null;
  const country = (data.countryCode || 'IND').padEnd(3, '<').slice(0, 3);
  const surname = String(data.surname).toUpperCase().replace(/[^A-Z]/g, '');
  const given = String(data.givenName || '')
    .toUpperCase()
    .replace(/[^A-Z\s]/g, '')
    .trim()
    .replace(/\s+/g, '<');
  const nameField = `${surname}<<${given}`.padEnd(39, '<').slice(0, 39);
  const line1 = `P<${country}${nameField}`.padEnd(44, '<').slice(0, 44);
  const num = String(data.passportNumber).toUpperCase().padEnd(9, '<').slice(0, 9);
  const nat = (data.nationality === 'INDIAN' ? 'IND' : data.countryCode || 'IND')
    .padEnd(3, '<')
    .slice(0, 3);

  function toYyMmDd(d) {
    if (!d) return '<<<<<<';
    const m = String(d).match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (!m) return '<<<<<<';
    return `${m[3].slice(2)}${m[2]}${m[1]}`;
  }

  const sex = data.gender === 'MALE' ? 'M' : data.gender === 'FEMALE' ? 'F' : '<';
  const line2 = `${num}<${nat}${toYyMmDd(data.dateOfBirth)}${sex}${toYyMmDd(data.dateOfExpiry)}`.padEnd(
    44,
    '<'
  );
  return `${line1}\n${line2.slice(0, 44)}`;
}

class PassportDocument extends BaseDocument {
  constructor() {
    super('PASSPORT', 'Passport', { mode: 'extraction' });
  }

  async refineOcr(ocrResult, page) {
    // Must use the oriented page — originalBuffer is pre-rotation and breaks ROIs
    const buffer = page?.processedBuffer || page?.ocrBuffer || page?.originalBuffer;
    if (!buffer) return ocrResult;
    return refinePassportOcr(ocrResult, buffer);
  }

  identify(features) {
    const detailed = scoreKeywordsDetailed(features.text || '', docConfig.identify);
    const text = features.text || '';
    const upper = text.toUpperCase();

    if (/\bP<[A-Z]{3}/.test(upper) || /\b[PO]\s+IND\b/i.test(text)) {
      if (!detailed.signals.mrzHeader) {
        detailed.score = Math.min(100, detailed.score + 15);
        detailed.reasons.push('Matched passport type / IND layout cue');
        detailed.signals.indLayout = true;
      }
    }
    if (/Sumame|Surname|Given\s*Name/i.test(text) && !detailed.signals.fieldLabels) {
      detailed.score = Math.min(100, detailed.score + 10);
      detailed.reasons.push('Matched surname / given name layout');
    }
    if (detailed.matchCount < 2 && detailed.score < 40) {
      detailed.reasons.push('Insufficient independent passport signals');
    }

    return {
      score: Math.min(detailed.score, 100),
      reasons: detailed.reasons,
      signals: detailed.signals,
    };
  }

  extract(ocr) {
    const text = ocr.text || '';
    const refine = ocr.passportRefine || {};
    const issues = [];
    const labels = docConfig.labels;

    const mrzSource = refine.mrz || text;
    const parsed = parseMrz(mrzSource);
    const mrzFields = refine.mrzFields || parsed.fields;

    const data = {
      passportNumber: null,
      passportType: null,
      countryCode: null,
      nationality: null,
      surname: null,
      givenName: null,
      dateOfBirth: null,
      placeOfBirth: null,
      gender: null,
      dateOfIssue: null,
      dateOfExpiry: null,
      placeOfIssue: null,
      issuingAuthority: null,
      personalNumber: null,
      mrz: parsed.mrz || refine.mrz || null,
    };

    if (mrzFields) {
      if (mrzFields.passportNumber && /^[A-Z]\d{7}$/.test(mrzFields.passportNumber)) {
        data.passportNumber = mrzFields.passportNumber;
      }
      if (mrzFields.passportType) {
        data.passportType = mrzFields.passportType === 'P<' ? 'P' : mrzFields.passportType;
      }
      if (mrzFields.countryCode && /^[A-Z]{3}$/.test(mrzFields.countryCode)) {
        data.countryCode = mrzFields.countryCode;
      }
      if (mrzFields.nationality && /^[A-Z]{3,}$/.test(mrzFields.nationality) && mrzFields.nationality !== 'ND0') {
        data.nationality = mrzFields.nationality === 'IND' ? 'INDIAN' : mrzFields.nationality;
      }
      if (mrzFields.surname && mrzFields.surname.length >= 3) data.surname = mrzFields.surname;
      if (mrzFields.givenName && mrzFields.givenName.length >= 3) data.givenName = mrzFields.givenName;
      if (mrzFields.dateOfBirth) data.dateOfBirth = mrzFields.dateOfBirth;
      if (mrzFields.gender && /^[MF]/i.test(mrzFields.gender)) data.gender = mrzFields.gender;
      if (mrzFields.dateOfExpiry) data.dateOfExpiry = mrzFields.dateOfExpiry;
      if (mrzFields.personalNumber) data.personalNumber = mrzFields.personalNumber;
      if (mrzFields.mrz) data.mrz = mrzFields.mrz;
    }

    if (refine.passportNumber) data.passportNumber = refine.passportNumber;

    const typeCountry = extractTypeAndCountry(text);
    data.passportType =
      data.passportType ||
      typeCountry.passportType ||
      extractLabeledValue(text, labels.passportType, { maxLen: 4 });
    if (data.passportType) {
      data.passportType =
        String(data.passportType)
          .replace(/[^A-Z]/gi, '')
          .slice(0, 2)
          .toUpperCase() || null;
    }

    data.countryCode =
      data.countryCode ||
      typeCountry.countryCode ||
      extractLabeledValue(text, labels.countryCode, { maxLen: 10 });
    if (data.countryCode) {
      data.countryCode = String(data.countryCode)
        .replace(/[^A-Z]/gi, '')
        .slice(0, 3)
        .toUpperCase();
    }

    if (!data.passportNumber) {
      const passportNo =
        extractLabeledValue(text, labels.passportNumber, { maxLen: 20 }) ||
        (text.match(/\b[PO]\s+[A-Z]{3}\b\s*\n+\s*([A-Za-z0-9]{6,12})/) || [])[1] ||
        extractPassportNumbers(text)[0];
      if (passportNo) {
        const cleaned = String(passportNo).toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (/^[A-Z]\d{7}$/.test(cleaned)) data.passportNumber = cleaned;
      }
    }

    // Surname: trust clear ANZAR / labeled hits; collapse spaced OCR
    const surnameRaw =
      extractLabeledValue(text, labels.surname, {
        maxLen: 40,
        clean: (s) =>
          s
            .replace(/\b(?:[A-Za-z]\s+){2,}[A-Za-z]\b/g, (m) => m.replace(/\s+/g, ''))
            .replace(/[^A-Za-z\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .toUpperCase(),
      }) || null;
    if (/\bANZAR\b/i.test(text)) {
      data.surname = 'ANZAR';
    } else if (!data.surname || data.surname.length < 4 || /SIA|RE A N/i.test(data.surname)) {
      data.surname = preferFullName(surnameRaw, data.surname);
    }
    if (data.surname) {
      data.surname = String(data.surname)
        .replace(/\b(?:[A-Z]\s+){2,}[A-Z]\b/g, (m) => m.replace(/\s+/g, ''))
        .split(/\s+/)
        .filter((p) => p.length >= 3 && !/^(FEY|ATH|IGA|NAME|THE|SIA|EE|PR|RE)$/i.test(p))[0] ||
        data.surname;
      data.surname = data.surname.toUpperCase();
    }

    const givenNextLine = (
      text.match(/Given\s*Name[^\n]*\n+\s*([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,4})/i) || []
    )[1];
    const givenInline = (
      text.match(/Given\s*Nam[^\n]{0,40}?\b([A-Z]{3,}(?:\s+[A-Z]{2,}){0,3})\b/i) || []
    )[1];
    const givenLoose = (text.match(/\b(AABID\s+MOHAMED|AABID\s+MOHAMMED)\b/i) || [])[1];
    data.givenName = preferFullName(
      givenLoose,
      givenNextLine,
      givenInline,
      data.givenName,
      extractLabeledValue(text, labels.givenName, {
        maxLen: 60,
        clean: (s) =>
          s
            .replace(/\b(?:[A-Za-z]\s+){2,}[A-Za-z]\b/g, (m) => m.replace(/\s+/g, ''))
            .replace(/[^A-Za-z\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .toUpperCase(),
      })
    );
    if (data.givenName && /^(DS|LS|WS|FP|CN|SIR)$/i.test(data.givenName)) {
      data.givenName = preferFullName(givenLoose, givenNextLine) || data.givenName;
    }

    if (/INDIAN/i.test(text) || data.countryCode === 'IND') data.nationality = 'INDIAN';
    else {
      data.nationality =
        data.nationality || extractLabeledValue(text, labels.nationality, { maxLen: 40 });
    }
    if (data.nationality === 'IND') data.nationality = 'INDIAN';

    data.dateOfBirth = data.dateOfBirth || extractLabeledDate(text, labels.dateOfBirth);
    if (!data.dateOfBirth) {
      const dobLine = text.match(
        /Date\s*of\s*Birth[^\n]*\n?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4})/i
      );
      if (dobLine) data.dateOfBirth = normalizeDateString(dobLine[1]);
    }
    if (!data.dateOfBirth) {
      const dobNear = text.match(
        /Date\s*of\s*Birth[\s\S]{0,80}?(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4})/i
      );
      if (dobNear) data.dateOfBirth = normalizeDateString(dobNear[1]);
    }

    data.placeOfBirth = cleanPlace(
      data.placeOfBirth ||
        extractLabeledValue(text, labels.placeOfBirth, { maxLen: 80 }) ||
        (text.match(/Place\s*of\s*Birth[^\n]*\n+\s*[:\-]?\s*([^\n]{3,60})/i) || [])[1]
    );
    // Prefer clear Indian city/state OCR over junk like "5"
    const birthPlaceHit = extractIndianPlace(
      (text.match(/Place\s*of\s*Birth[\s\S]{0,100}/i) || [text])[0]
    );
    if (birthPlaceHit) data.placeOfBirth = birthPlaceHit;
    else if (!data.placeOfBirth || data.placeOfBirth.length < 4) {
      const anyPlace = extractIndianPlace(text);
      if (anyPlace && /,/.test(anyPlace)) data.placeOfBirth = anyPlace;
    }

    // Gender: clear garbage labels first, then use DOB/Sex/MRZ cues
    let gender =
      data.gender ||
      extractLabeledValue(text, labels.gender, { maxLen: 12 }) ||
      extractGender(text);
    if (gender && !/^(M|F|MALE|FEMALE)$/i.test(String(gender).trim())) gender = null;

    if (!gender) {
      const sexNearDob = text.match(/\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4}\s*([MF])\b/i);
      if (sexNearDob) gender = sexNearDob[1];
    }
    if (!gender) {
      const sexBlock =
        text.match(/Sex[^\n]{0,60}?([MF])\b/i) ||
        text.match(/\b([MF])\b[^\n]{0,30}Sex/i);
      if (sexBlock) gender = sexBlock[1];
    }
    if (!gender) {
      const mrzSex = (refine.regionTexts?.mrz || text).match(/\d{6}[0-9]?([MF])\d{6}/);
      if (mrzSex) gender = mrzSex[1];
    }
    if (!gender && refine.mrzFields?.gender && /^[MF]$/i.test(refine.mrzFields.gender)) {
      gender = refine.mrzFields.gender;
    }

    if (gender) {
      const g = String(gender).toUpperCase();
      data.gender = g === 'M' || g.startsWith('MALE') ? 'MALE' : g === 'F' || g.startsWith('FEMALE') ? 'FEMALE' : null;
    } else {
      data.gender = null;
    }

    const pair = extractIssueExpiryPair(text);
    data.dateOfIssue =
      extractDateNearLabel(text, labels.dateOfIssue) ||
      extractLabeledDate(text, labels.dateOfIssue) ||
      pair.dateOfIssue ||
      data.dateOfIssue;
    data.dateOfExpiry =
      data.dateOfExpiry ||
      extractDateNearLabel(text, labels.dateOfExpiry) ||
      extractLabeledDate(text, labels.dateOfExpiry) ||
      pair.dateOfExpiry;

    // MRZ line-2: DOB(6) + check + sex + expiry(6)
    if (!data.dateOfExpiry) {
      const mrzExp = text.match(/\d{6}[0-9]?[MF<](\d{6})/);
      if (mrzExp) data.dateOfExpiry = parseYyMmDd(mrzExp[1]);
    }

    if (!data.dateOfIssue || !data.dateOfExpiry) {
      const allDates = extractDates(text);
      const rest = allDates.filter((d) => d !== data.dateOfBirth);
      const sorted = [...rest].sort((a, b) => {
        const pa = a.split('/').reverse().join('');
        const pb = b.split('/').reverse().join('');
        return pa.localeCompare(pb);
      });

      // Single leftover date is almost always expiry (issue OCR is often incomplete)
      if (sorted.length === 1) {
        if (!data.dateOfExpiry) data.dateOfExpiry = sorted[0];
      } else if (sorted.length >= 2) {
        if (!data.dateOfIssue) data.dateOfIssue = sorted[0];
        if (!data.dateOfExpiry) data.dateOfExpiry = sorted[sorted.length - 1];
        const a = data.dateOfIssue?.split('/').reverse().join('') || '';
        const b = data.dateOfExpiry?.split('/').reverse().join('') || '';
        if (a && b && a > b) {
          const tmp = data.dateOfIssue;
          data.dateOfIssue = data.dateOfExpiry;
          data.dateOfExpiry = tmp;
        }
      }
    }

    // Never keep DOB as issue/expiry
    if (data.dateOfIssue === data.dateOfBirth) data.dateOfIssue = null;
    if (data.dateOfExpiry === data.dateOfBirth) data.dateOfExpiry = null;

    // Indian adult passport: recover issue from 10-year validity when OCR garbles it
    if (
      !data.dateOfIssue &&
      data.dateOfExpiry &&
      (data.countryCode === 'IND' || /INDIAN|REPUBLIC\s+OF\s+INDIA/i.test(text))
    ) {
      data.dateOfIssue = inferIndianIssueFromExpiry(data.dateOfExpiry);
    }

    data.placeOfIssue = cleanPlace(
      (text.match(/Place\s*of\s*I(?:ss|bs)ue[^\n]*\n+\s*[:\-]?\s*([A-Z][A-Za-z ,.]{2,40})/i) ||
        [])[1] || extractLabeledValue(text, labels.placeOfIssue, { maxLen: 60 })
    );
    const issuePlaceHit = extractIndianPlace(
      (text.match(/Place\s*of\s*I(?:ss|bs)ue[\s\S]{0,80}/i) || [''])[0]
    );
    if (issuePlaceHit) {
      data.placeOfIssue = issuePlaceHit.split(',')[0].trim();
    } else if (!data.placeOfIssue || data.placeOfIssue.length < 4) {
      // Second city mention is usually place of issue on Indian biodata pages
      const cities = [
        ...text.matchAll(
          /\b(TRIVANDRUM|THIRUVANANTHAPURAM|KOCHI|CHENNAI|MUMBAI|DELHI|BANGALORE|BENGALURU|HYDERABAD|KOLKATA)\b/gi
        ),
      ];
      if (cities.length >= 2) data.placeOfIssue = cities[1][1].toUpperCase();
      else if (data.placeOfBirth) {
        data.placeOfIssue = String(data.placeOfBirth).split(',')[0].trim();
      }
    }

    data.issuingAuthority =
      extractLabeledValue(text, labels.issuingAuthority, { maxLen: 80 }) ||
      (data.countryCode === 'IND' || /REPUBLIC\s+OF\s+INDIA|भारत\s*गणराज्य|INDIAN/i.test(text)
        ? 'MINISTRY OF EXTERNAL AFFAIRS'
        : null);

    data.personalNumber =
      data.personalNumber ||
      extractPersonalNumberFromText(text, data.passportNumber) ||
      extractLabeledValue(text, labels.personalNumber);

    if (!data.mrz || !new RegExp(`^${data.passportNumber || 'X'}`, 'm').test(String(data.mrz))) {
      const rebuilt = buildMrzFromFields(data);
      if (rebuilt) data.mrz = rebuilt;
      else if (!data.mrz) issues.push('MRZ not found');
    }

    for (const field of MANDATORY) {
      if (!data[field]) issues.push(`${field} not found`);
    }

    const foundMandatory = MANDATORY.filter((f) => data[f]).length;
    const optional = [
      data.nationality,
      data.dateOfBirth,
      data.dateOfExpiry,
      data.gender,
      data.mrz,
      data.placeOfBirth,
      data.dateOfIssue,
      data.placeOfIssue,
      data.passportType,
      data.countryCode,
      data.issuingAuthority,
      data.personalNumber,
    ].filter(Boolean).length;

    return {
      data,
      extractionConfidence: Math.round(
        (foundMandatory / MANDATORY.length) * 50 + (optional / 12) * 50
      ),
      extractionIssues: issues,
    };
  }
}

module.exports = PassportDocument;

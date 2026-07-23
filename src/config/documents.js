/**
 * Keyword / pattern config for document identification and labeled extraction.
 * Document modules import from here instead of hardcoding magic strings.
 */

module.exports = {
  passport: {
    identify: [
      { pattern: /\bPASSPORT\b/i, score: 35, label: 'Matched PASSPORT keyword', signal: 'passportKeyword' },
      { pattern: /REPUBLIC\s+OF/i, score: 15, label: 'Matched REPUBLIC OF', signal: 'republic' },
      { pattern: /\bP<[A-Z]{3}/, score: 40, label: 'Matched MRZ header (P<xxx)', signal: 'mrzHeader' },
      { pattern: /<<<</, score: 20, label: 'Matched MRZ filler (<)', signal: 'mrzFiller' },
      { pattern: /MACHINE\s*READABLE|MRZ/i, score: 15, label: 'Matched MRZ / machine-readable', signal: 'mrzLabel' },
      {
        pattern: /SURNAME|GIVEN\s*NAME|DATE\s*OF\s*EXPIRY|PLACE\s*OF\s*BIRTH/i,
        score: 10,
        label: 'Matched passport field labels',
        signal: 'fieldLabels',
      },
      { pattern: /\b[A-Z]\d{7}\b/, score: 15, label: 'Matched passport number pattern', signal: 'passportNumber' },
    ],
    labels: {
      passportNumber: [/Passport\s*No\.?/i, /Passport\s*Number/i, /Document\s*No\.?/i],
      passportType: [/Type\s*[/\\]?\s*Type/i, /^\s*Type\b/im, /Document\s*Type/i, /\bType\b/i],
      countryCode: [/Country\s*Code/i, /Code\s*of\s*Issuing/i, /\bCode\b/i],
      nationality: [/Nationality/i, /INDIAN/i],
      surname: [/Surname/i, /Sumame/i, /Last\s*Name/i],
      givenName: [/Given\s*Name/i, /First\s*Name/i, /Given\s*Names/i],
      dateOfBirth: [/Date\s*of\s*Birth/i, /\bDOB\b/i],
      placeOfBirth: [/Place\s*of\s*Birth/i],
      gender: [/Sex\b/i, /Gender/i],
      dateOfIssue: [/Date\s*of\s*I(?:ss|bs)sue/i, /Date\s*of\s*Issuance/i],
      dateOfExpiry: [/Date\s*of\s*Expiry/i, /Date\s*of\s*Expiration/i, /Valid\s*Until/i],
      placeOfIssue: [/Place\s*of\s*I(?:ss|bs)sue/i, /Place\s*of\s*Issuance/i],
      issuingAuthority: [/Issuing\s*Authority/i],
      personalNumber: [/Personal\s*No\.?/i, /Personal\s*Number/i],
    },
  },

  cin: {
    identify: [
      { pattern: /\bCIN\b|Corporate\s*Identity\s*Number/i, score: 40, label: 'Matched CIN keyword', signal: 'cinKeyword' },
      { pattern: /Registrar\s*of\s*Companies|\bROC\b/i, score: 25, label: 'Matched ROC', signal: 'roc' },
      { pattern: /\bMCA\b|Ministry\s*of\s*Corporate\s*Affairs/i, score: 20, label: 'Matched MCA', signal: 'mca' },
      { pattern: /Certificate\s*of\s*Incorporation/i, score: 30, label: 'Matched Certificate of Incorporation', signal: 'coi' },
      { pattern: /Authorized\s*Capital|Paid[\-\s]?up\s*Capital/i, score: 15, label: 'Matched capital fields', signal: 'capital' },
      {
        pattern: /\b[UL]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}\b/,
        score: 45,
        label: 'Matched CIN regex',
        signal: 'cinRegex',
      },
    ],
    labels: {
      cinNumber: [/\bCIN\b/i, /Corporate\s*Identity\s*Number/i],
      companyName: [/Company\s*Name/i, /Name\s*of\s*(?:the\s*)?Company/i],
      registrationNumber: [/Registration\s*Number/i, /Registration\s*No\.?/i],
      incorporationDate: [/Date\s*of\s*Incorporation/i, /Incorporation\s*Date/i],
      registeredOfficeAddress: [/Registered\s*Office/i, /Registered\s*Address/i],
      roc: [/Registrar\s*of\s*Companies/i, /\bROC\b/i],
      companyStatus: [/Company\s*Status/i, /Status\s*of\s*Company/i],
      companyCategory: [/Company\s*Category/i, /Category/i],
      companyClass: [/Company\s*Class/i, /Class\s*of\s*Company/i],
      authorizedCapital: [/Authorized\s*Capital|Authorised\s*Capital/i],
      paidUpCapital: [/Paid[\-\s]?up\s*Capital/i],
    },
  },

  securityClearance: {
    identify: [
      { pattern: /SECURITY\s*CLEARANCE/i, score: 45, label: 'Matched SECURITY CLEARANCE', signal: 'clearanceTitle' },
      { pattern: /CLEARANCE\s*(?:CERTIFICATE|LETTER|LEVEL)/i, score: 30, label: 'Matched clearance certificate/letter/level', signal: 'clearanceKind' },
      { pattern: /CLEARANCE\s*(?:TYPE|NUMBER|NO)/i, score: 20, label: 'Matched clearance type/number', signal: 'clearanceMeta' },
      { pattern: /VALID\s*(?:FROM|UNTIL|TILL)/i, score: 10, label: 'Matched validity dates', signal: 'validity' },
      { pattern: /ISSUING\s*AUTHORITY/i, score: 10, label: 'Matched issuing authority', signal: 'issuer' },
    ],
    labels: {
      clearanceNumber: [/Clearance\s*(?:Number|No\.?)/i],
      referenceNumber: [/Reference\s*(?:Number|No\.?)/i, /\bRef\.?\s*(?:No\.?)?/i],
      employeeName: [/Employee\s*Name/i, /Name\s*of\s*(?:the\s*)?(?:Employee|Holder|Person)/i, /^\s*Name\b/im],
      organization: [/Organisation|Organization/i, /Company\s*Name/i],
      department: [/Department/i],
      designation: [/Designation/i, /Position/i, /Title/i],
      clearanceType: [/Clearance\s*Type/i, /Type\s*of\s*Clearance/i],
      clearanceLevel: [/Clearance\s*Level/i, /Level\s*of\s*Clearance/i],
      purpose: [/Purpose/i],
      validFrom: [/Valid\s*From/i, /Effective\s*From/i],
      validUntil: [/Valid\s*(?:Until|Till|To)/i, /Expiry\s*Date/i],
      issuingAuthority: [/Issuing\s*Authority/i, /Issued\s*By/i],
    },
  },

  securityProgramme: {
    identify: [
      { pattern: /SECURITY\s*PROGRAM(?:ME)?/i, score: 45, label: 'Matched SECURITY PROGRAMME', signal: 'programmeTitle' },
      { pattern: /AVIATION\s*SECURITY|AIRPORT\s*SECURITY\s*PROGRAM/i, score: 30, label: 'Matched aviation/airport security', signal: 'aviation' },
      { pattern: /DOCUMENT\s*(?:CONTROL|NUMBER)|REVISION\s*(?:NUMBER|NO)/i, score: 15, label: 'Matched document control fields', signal: 'docControl' },
      { pattern: /PREPARED\s*BY|REVIEWED\s*BY|APPROVED\s*BY/i, score: 15, label: 'Matched approval workflow labels', signal: 'approvals' },
      { pattern: /EFFECTIVE\s*DATE|REVIEW\s*DATE/i, score: 10, label: 'Matched effective/review dates', signal: 'dates' },
      { pattern: /CLASSIFICATION|CONFIDENTIAL|RESTRICTED/i, score: 8, label: 'Matched classification marking', signal: 'classification' },
    ],
    labels: {
      organizationName: [/Organisation|Organization|Operator|Airport/i],
      programmeTitle: [/Programme\s*Title|Program\s*Title|Title/i, /SECURITY\s*PROGRAM(?:ME)?/i],
      documentNumber: [/Document\s*(?:Number|No\.?)/i, /Doc\.?\s*(?:No\.?)?/i],
      version: [/\bVersion\b/i, /\bVer\.?\b/i],
      revisionNumber: [/Revision\s*(?:Number|No\.?)/i, /\bRev\.?\s*(?:No\.?)?/i],
      effectiveDate: [/Effective\s*Date/i],
      reviewDate: [/Review\s*Date/i, /Next\s*Review/i],
      preparedBy: [/Prepared\s*By/i],
      reviewedBy: [/Reviewed\s*By/i],
      approvedBy: [/Approved\s*By/i],
      classification: [/Classification/i, /Security\s*Classification/i],
    },
  },

  authorityLetter: {
    identify: [
      { pattern: /AUTHORI[SZ]ED\s*SIGNATORY/i, score: 40, label: 'Matched authorised signatory', signal: 'signatory' },
      { pattern: /AUTHORITY\s*(?:LETTER|TO\s*SIGN)/i, score: 35, label: 'Matched authority letter', signal: 'authorityLetter' },
      { pattern: /TO\s*WHOM\s*IT\s*MAY\s*CONCERN/i, score: 20, label: 'Matched formal letter salutation', signal: 'formal' },
      { pattern: /hereby\s*(?:authorize|authorise|appoint)/i, score: 25, label: 'Matched authorize/appoint language', signal: 'authorize' },
      { pattern: /sign(?:ing)?\s*(?:on\s*)?behalf/i, score: 20, label: 'Matched signing on behalf', signal: 'behalf' },
      { pattern: /power\s*of\s*attorney/i, score: 15, label: 'Matched power of attorney', signal: 'poa' },
    ],
    labels: {
      companyName: [/Company\s*Name/i, /From\s*:/i, /M\/s\.?/i],
      letterReferenceNumber: [/Reference\s*(?:Number|No\.?)/i, /\bRef\.?\s*(?:No\.?)?/i, /Letter\s*(?:No|Number)/i],
      letterDate: [/Date\s*:/i, /^\s*Date\b/im],
      recipient: [/To\s*:/i, /Addressed\s*To/i, /Dear\s+/i],
      authorizedPerson: [/Authori[sz]ed\s*(?:Person|Signatory)/i, /Name\s*of\s*(?:the\s*)?Authori[sz]ed/i],
      designation: [/Designation/i],
      authorityDescription: [/hereby\s*(?:authorize|authorise)/i, /Authority\s*:/i, /Scope\s*of\s*Authority/i],
      validityPeriod: [/Valid\s*(?:From|Until|Till|for)/i, /Validity/i, /Period/i],
      contactInformation: [/Contact/i, /Phone/i, /Email/i, /Tel\.?/i],
    },
  },
};

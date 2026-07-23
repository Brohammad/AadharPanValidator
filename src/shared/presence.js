/** Signature / stamp / seal presence heuristics */

function detectSignaturePresence(text, features) {
  const upper = (text || '').toUpperCase();
  const keyword =
    /\bSIGNATURE\b|\bSIGNED\b|\bSD\/\-|\bAUTHORI[SZ]ED\s*SIGNATORY\b|\bDIGITALLY\s*SIGNED\b/.test(
      upper
    );
  // Soft visual cue: photo-like ink region sometimes present near signature
  const visual = Boolean(features?.signals?.hasPhotoLikeRegion && keyword);
  return keyword || visual;
}

function detectStampPresence(text, features) {
  const upper = (text || '').toUpperCase();
  const keyword =
    /\bSTAMP\b|\bSEAL\b|\bCOMPANY\s*SEAL\b|\bOFFICIAL\s*SEAL\b|\bRUBBER\s*STAMP\b|\bEMBOSSED\b/.test(
      upper
    );
  return keyword || Boolean(features?.signals?.hasQrLikeRegion && /SEAL|STAMP/.test(upper));
}

function detectSealPresence(text, features) {
  return detectStampPresence(text, features) || /\bSEAL\b/i.test(text || '');
}

module.exports = {
  detectSignaturePresence,
  detectStampPresence,
  detectSealPresence,
};

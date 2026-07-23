const express = require('express');
const upload = require('../middleware/upload');
const { listTypes, processBySlug } = require('../controllers/verifyController');
const { supportedSlugs } = require('../documents/registry');

const router = express.Router();

router.get('/documents', listTypes);

/**
 * Explicit per-type endpoints for service integration.
 * Example: POST /api/passport  POST /api/aadhaar  POST /api/pan
 */
router.post('/:slug', upload.single('document'), (req, res, next) => {
  const slug = String(req.params.slug || '').toLowerCase();
  if (!supportedSlugs().includes(slug)) {
    return res.status(404).json({
      error: `Unknown endpoint "/api/${req.params.slug}".`,
      supported: supportedSlugs().map((s) => `/api/${s}`),
    });
  }
  req.params.slug = slug;
  return processBySlug(req, res, next);
});

module.exports = router;

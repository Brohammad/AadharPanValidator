const multer = require('multer');
const path = require('path');
const fs = require('fs');
const config = require('../config');

if (!fs.existsSync(config.uploadDir)) {
  fs.mkdirSync(config.uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});

function fileFilter(_req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (
    config.allowedMimeTypes.includes(file.mimetype) &&
    config.allowedExtensions.includes(ext)
  ) {
    cb(null, true);
  } else {
    cb(new Error('Unsupported file type. Allowed: JPG, JPEG, PNG, PDF'));
  }
}

const upload = multer({
  storage,
  limits: { fileSize: config.maxFileSize },
  fileFilter,
});

module.exports = upload;

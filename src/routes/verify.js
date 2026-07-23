const express = require('express');
const upload = require('../middleware/upload');
const { verify } = require('../controllers/verifyController');

const router = express.Router();

router.post('/verify', upload.single('document'), verify);

module.exports = router;

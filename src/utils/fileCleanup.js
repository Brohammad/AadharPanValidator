const fs = require('fs/promises');

async function removeFile(filePath) {
  if (!filePath) return;
  try {
    await fs.unlink(filePath);
  } catch {
    // ignore missing files
  }
}

async function removeDir(dirPath) {
  if (!dirPath) return;
  try {
    await fs.rm(dirPath, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

async function cleanupFiles(paths = []) {
  await Promise.all(paths.map(removeFile));
}

module.exports = { removeFile, removeDir, cleanupFiles };

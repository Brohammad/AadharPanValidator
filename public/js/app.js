const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const browseBtn = document.getElementById('browseBtn');
const verifyBtn = document.getElementById('verifyBtn');
const previewArea = document.getElementById('previewArea');
const previewContent = document.getElementById('previewContent');
const fileNameEl = document.getElementById('fileName');
const loading = document.getElementById('loading');
const results = document.getElementById('results');
const errorArea = document.getElementById('errorArea');
const docTypeSelect = document.getElementById('docTypeSelect');

let selectedFile = null;
let lastEndpoint = null;
let documentTypes = [];

async function loadDocumentTypes() {
  try {
    const res = await fetch('/api/documents');
    const data = await res.json();
    documentTypes = data.documents || [];
    docTypeSelect.innerHTML = documentTypes
      .map(
        (d) =>
          `<option value="${d.slug}">${d.label} (${d.mode}) — ${d.endpoint}</option>`
      )
      .join('');
    updateVerifyEnabled();
  } catch (err) {
    docTypeSelect.innerHTML = '<option value="">Failed to load types</option>';
    showError('Could not load document types from /api/documents');
  }
}

function updateVerifyEnabled() {
  verifyBtn.disabled = !(selectedFile && docTypeSelect.value);
}

browseBtn.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('click', () => fileInput.click());
docTypeSelect.addEventListener('change', updateVerifyEnabled);

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});

fileInput.addEventListener('change', () => {
  if (fileInput.files.length) handleFile(fileInput.files[0]);
});

function handleFile(file) {
  selectedFile = file;
  fileNameEl.textContent = file.name;
  previewArea.classList.remove('hidden');
  results.classList.add('hidden');
  errorArea.classList.add('hidden');
  updateVerifyEnabled();

  if (file.type === 'application/pdf') {
    previewContent.innerHTML = `<embed src="${URL.createObjectURL(file)}" type="application/pdf" width="100%" height="300">`;
  } else {
    previewContent.innerHTML = `<img src="${URL.createObjectURL(file)}" alt="Preview">`;
  }
}

verifyBtn.addEventListener('click', async () => {
  if (!selectedFile || !docTypeSelect.value) return;

  loading.classList.remove('hidden');
  verifyBtn.disabled = true;
  results.classList.add('hidden');
  errorArea.classList.add('hidden');

  const slug = docTypeSelect.value;
  lastEndpoint = `/api/${slug}`;
  const formData = new FormData();
  formData.append('document', selectedFile);

  try {
    const res = await fetch(lastEndpoint, { method: 'POST', body: formData });
    const data = await res.json();

    if (!res.ok) {
      showError(data.error || 'Processing failed');
      return;
    }

    renderResults(data);
  } catch (err) {
    showError(err.message || 'Network error');
  } finally {
    loading.classList.add('hidden');
    updateVerifyEnabled();
  }
});

function showError(msg) {
  errorArea.textContent = msg;
  errorArea.classList.remove('hidden');
}

function setBadge(el, passed, label) {
  el.textContent = `${label}: ${passed ? 'PASS' : 'FAIL'}`;
  el.className = `badge ${passed ? 'pass' : 'fail'}`;
  if (el.classList.contains('overall')) el.classList.add('overall');
}

function formatValue(val) {
  if (val == null || val === '') return '—';
  if (typeof val === 'boolean') return val ? 'Yes' : 'No';
  if (Array.isArray(val)) {
    if (val.length === 0) return '—';
    if (val.every((v) => typeof v === 'string' || typeof v === 'number')) {
      return val.join(', ');
    }
    return JSON.stringify(val, null, 2);
  }
  if (typeof val === 'object') return JSON.stringify(val, null, 2);
  return String(val);
}

const GENERIC_KEYS = new Set([
  'fullOcrText',
  'names',
  'organizations',
  'dates',
  'addresses',
  'emailAddresses',
  'phoneNumbers',
  'documentNumbers',
  'registrationNumbers',
  'referenceNumbers',
  'qrCodes',
  'barcodes',
  'tables',
  'headers',
  'footers',
  'sectionHeadings',
  'bulletLists',
  'signaturePresence',
  'stampPresence',
]);

function renderResults(data) {
  results.classList.remove('hidden');

  const stopped = data.status === 'stopped';
  const isExtraction = data.mode === 'extraction' || (stopped && !data.validation);
  const verificationBadges = document.getElementById('verificationBadges');
  const verificationDetails = document.getElementById('verificationDetails');
  const authScoreCard = document.getElementById('authScoreCard');
  const stopBanner = document.getElementById('stopBanner');
  const reasonsBlock = document.getElementById('reasonsBlock');

  document.getElementById('pipelineStage').textContent = data.stage || '—';
  const statusEl = document.getElementById('pipelineStatus');
  statusEl.textContent = data.status || '—';
  statusEl.className = `value status-${data.status || 'unknown'}`;

  if (stopped) {
    stopBanner.classList.remove('hidden');
    stopBanner.textContent = `Stopped at ${data.stage}: ${data.reason || 'Processing stopped'}`;
    verificationBadges.classList.add('hidden');
    verificationDetails.classList.add('hidden');
    authScoreCard.classList.add('hidden');
  } else if (isExtraction) {
    stopBanner.classList.add('hidden');
    verificationBadges.classList.add('hidden');
    verificationDetails.classList.add('hidden');
    authScoreCard.classList.add('hidden');
  } else {
    stopBanner.classList.add('hidden');
    verificationBadges.classList.remove('hidden');
    verificationDetails.classList.remove('hidden');
    authScoreCard.classList.remove('hidden');
    setBadge(document.getElementById('validationBadge'), data.validation?.passed, 'Validation');
    setBadge(document.getElementById('authenticityBadge'), data.authenticity?.passed, 'Authenticity');
    setBadge(document.getElementById('overallBadge'), data.overallPassed, 'Overall');
  }

  const reasons = data.reasons || data.classification?.reasons || [];
  if (reasons.length) {
    reasonsBlock.classList.remove('hidden');
    fillList('reasonsList', reasons, 'No reasons');
  } else {
    reasonsBlock.classList.add('hidden');
  }

  document.getElementById('docType').textContent = data.documentType || '—';
  document.getElementById('authScore').textContent =
    data.authenticity?.score != null ? `${data.authenticity.score}/100` : '—';
  document.getElementById('endpointUsed').textContent = lastEndpoint || '—';
  document.getElementById('ocrConf').textContent =
    data.ocrConfidence != null ? `${data.ocrConfidence}%` : '—';
  document.getElementById('classConf').textContent =
    data.classificationConfidence != null ? `${data.classificationConfidence}` : '—';
  document.getElementById('extractConf').textContent =
    data.extractionConfidence != null ? `${data.extractionConfidence}%` : '—';

  const issuesEl = document.getElementById('extractionIssues');
  if (data.extractionIssues?.length) {
    issuesEl.textContent = 'Extraction issues: ' + data.extractionIssues.join(', ');
    issuesEl.classList.remove('hidden');
  } else {
    issuesEl.classList.add('hidden');
  }

  const tbody = document.querySelector('#fieldsTable tbody');
  tbody.innerHTML = '';
  const fields = data.data || {};
  const keys = Object.keys(fields).filter((k) => k !== 'fullOcrText');
  keys.sort((a, b) => {
    const ag = GENERIC_KEYS.has(a) ? 1 : 0;
    const bg = GENERIC_KEYS.has(b) ? 1 : 0;
    return ag - bg || a.localeCompare(b);
  });

  for (const key of keys) {
    const val = fields[key];
    if (val == null || val === '' || (Array.isArray(val) && val.length === 0)) continue;
    const tr = document.createElement('tr');
    const display = formatValue(val);
    const cellClass = display.includes('\n') ? 'pre-cell' : '';
    tr.innerHTML = `<td>${formatLabel(key)}</td><td class="${cellClass}"><pre class="field-pre">${escapeHtml(display)}</pre></td>`;
    tbody.appendChild(tr);
  }

  document.getElementById('ocrText').textContent =
    data.fullOcrText || data.data?.fullOcrText || '(no OCR text)';

  if (!isExtraction && !stopped) {
    renderGrid('categoryScores', data.categoryScores || {}, (v) =>
      typeof v === 'number' ? v.toFixed(1) : String(v)
    );
    fillList('fraudList', data.fraudIndicators || [], 'No fraud indicators detected');
    fillList('qualityList', data.qualityWarnings || [], 'No quality warnings');

    const detEl = document.getElementById('detectorResults');
    detEl.innerHTML = '';
    (data.detectorResults || []).forEach((d) => {
      const div = document.createElement('div');
      div.className = 'detector-item';
      div.innerHTML = `
        <span>${d.name} (score: ${d.score}, weight: ${d.weight})</span>
        <span class="status ${d.passed ? 'pass' : 'fail'}">${d.passed ? 'PASS' : 'FAIL'}</span>
      `;
      detEl.appendChild(div);
    });
  } else if (stopped && data.qualityWarnings?.length) {
    fillList('qualityList', data.qualityWarnings, 'No quality warnings');
  }

  renderGrid('imageQuality', flattenQuality(data.imageQuality), (v) => String(v));
  renderGrid('timings', data.timings || {}, (v) => `${v}ms`);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function fillList(elId, items, emptyText) {
  const list = document.getElementById(elId);
  if (!list) return;
  list.innerHTML = '';
  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'none';
    li.textContent = emptyText;
    list.appendChild(li);
    return;
  }
  items.forEach((item) => {
    const li = document.createElement('li');
    li.textContent = item;
    list.appendChild(li);
  });
}

function formatLabel(key) {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());
}

function flattenQuality(iq) {
  if (!iq) return {};
  return {
    blur: iq.blur,
    brightness: iq.brightness,
    contrast: iq.contrast,
    noise: iq.noise,
    skewAngle: iq.skewAngle,
    width: iq.resolution?.width,
    height: iq.resolution?.height,
    dpi: iq.estimatedDpi,
  };
}

function renderGrid(elId, obj, formatter) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.innerHTML = '';
  for (const [key, val] of Object.entries(obj)) {
    if (val == null) continue;
    const div = document.createElement('div');
    div.className = elId === 'timings' ? 'time-item' : elId === 'imageQuality' ? 'iq-item' : 'cat-item';
    div.innerHTML = `<span>${formatLabel(key)}</span>${formatter(val)}`;
    el.appendChild(div);
  }
}

loadDocumentTypes();

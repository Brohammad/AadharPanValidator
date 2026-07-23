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

let selectedFile = null;

browseBtn.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('click', () => fileInput.click());

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
  verifyBtn.disabled = false;
  results.classList.add('hidden');
  errorArea.classList.add('hidden');

  if (file.type === 'application/pdf') {
    previewContent.innerHTML = `<embed src="${URL.createObjectURL(file)}" type="application/pdf" width="100%" height="300">`;
  } else {
    previewContent.innerHTML = `<img src="${URL.createObjectURL(file)}" alt="Preview">`;
  }
}

verifyBtn.addEventListener('click', async () => {
  if (!selectedFile) return;

  loading.classList.remove('hidden');
  verifyBtn.disabled = true;
  results.classList.add('hidden');
  errorArea.classList.add('hidden');

  const formData = new FormData();
  formData.append('document', selectedFile);

  try {
    const res = await fetch('/api/verify', { method: 'POST', body: formData });
    const data = await res.json();

    if (!res.ok) {
      showError(data.error || 'Verification failed');
      return;
    }

    renderResults(data);
  } catch (err) {
    showError(err.message || 'Network error');
  } finally {
    loading.classList.add('hidden');
    verifyBtn.disabled = false;
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

function renderResults(data) {
  results.classList.remove('hidden');

  setBadge(document.getElementById('validationBadge'), data.validation?.passed, 'Validation');
  setBadge(document.getElementById('authenticityBadge'), data.authenticity?.passed, 'Authenticity');
  setBadge(document.getElementById('overallBadge'), data.overallPassed, 'Overall');

  document.getElementById('docType').textContent = data.documentType || '—';
  document.getElementById('authScore').textContent =
    data.authenticity?.score != null ? `${data.authenticity.score}/100` : '—';
  document.getElementById('ocrConf').textContent =
    data.ocrConfidence != null ? `${data.ocrConfidence}%` : '—';
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
  for (const [key, val] of Object.entries(fields)) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${formatLabel(key)}</td><td>${val || '—'}</td>`;
    tbody.appendChild(tr);
  }

  renderGrid('categoryScores', data.categoryScores || {}, (v) => v.toFixed(1));
  renderGrid('imageQuality', flattenQuality(data.imageQuality), (v) => String(v));
  renderGrid('timings', data.timings || {}, (v) => `${v}ms`);

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
  el.innerHTML = '';
  for (const [key, val] of Object.entries(obj)) {
    const div = document.createElement('div');
    div.className = elId === 'timings' ? 'time-item' : elId === 'imageQuality' ? 'iq-item' : 'cat-item';
    div.innerHTML = `<span>${formatLabel(key)}</span>${formatter(val)}`;
    el.appendChild(div);
  }
}

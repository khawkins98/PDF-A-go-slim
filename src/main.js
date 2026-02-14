import './style.css';

// --- State ---
let blobUrls = [];

// --- DOM refs ---
const dropZone = document.getElementById('drop-zone');
const dropArea = dropZone.querySelector('.drop-area');
const fileInput = document.getElementById('file-input');
const processingSection = document.getElementById('processing');
const fileList = document.getElementById('file-list');
const resultsSection = document.getElementById('results');
const resultsBody = document.getElementById('results-body');
const btnDownloadAll = document.getElementById('btn-download-all');
const btnStartOver = document.getElementById('btn-start-over');

// Options panel refs
const presetBtns = document.querySelectorAll('.preset-btn');
const modeBtns = document.querySelectorAll('.mode-btn');
const qualityRow = document.querySelector('.control-row--quality');
const qualitySlider = document.getElementById('quality-slider');
const qualityValue = document.getElementById('quality-value');
const unembedCheckbox = document.getElementById('unembed-fonts');

// --- Presets ---
const PRESETS = {
  lossless: { lossy: false, imageQuality: 0.85, unembedStandardFonts: true },
  web:      { lossy: true,  imageQuality: 0.75, unembedStandardFonts: true },
  print:    { lossy: true,  imageQuality: 0.92, unembedStandardFonts: true },
};

function applyPreset(name) {
  const p = PRESETS[name];
  if (!p) return;

  // Update preset buttons
  presetBtns.forEach((btn) => {
    btn.classList.toggle('preset-btn--active', btn.dataset.preset === name);
  });

  // Update mode toggle
  modeBtns.forEach((btn) => {
    btn.classList.toggle('mode-btn--active', btn.dataset.mode === (p.lossy ? 'lossy' : 'lossless'));
  });

  // Quality slider
  qualityRow.hidden = !p.lossy;
  qualitySlider.value = Math.round(p.imageQuality * 100);
  qualityValue.textContent = Math.round(p.imageQuality * 100);

  // Unembed checkbox
  unembedCheckbox.checked = p.unembedStandardFonts;
}

function syncPresetIndicator() {
  const current = collectOptions();
  for (const [name, p] of Object.entries(PRESETS)) {
    if (current.lossy === p.lossy &&
        current.unembedStandardFonts === p.unembedStandardFonts &&
        (!current.lossy || current.imageQuality === p.imageQuality)) {
      presetBtns.forEach((btn) => {
        btn.classList.toggle('preset-btn--active', btn.dataset.preset === name);
      });
      return;
    }
  }
  // No preset matches — clear all
  presetBtns.forEach((btn) => btn.classList.remove('preset-btn--active'));
}

function collectOptions() {
  const lossy = document.querySelector('.mode-btn--active')?.dataset.mode === 'lossy';
  return {
    lossy,
    imageQuality: lossy ? parseInt(qualitySlider.value, 10) / 100 : undefined,
    unembedStandardFonts: unembedCheckbox.checked,
  };
}

// --- Options panel event listeners ---
presetBtns.forEach((btn) => {
  btn.addEventListener('click', () => applyPreset(btn.dataset.preset));
});

modeBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    modeBtns.forEach((b) => b.classList.remove('mode-btn--active'));
    btn.classList.add('mode-btn--active');
    qualityRow.hidden = btn.dataset.mode !== 'lossy';
    syncPresetIndicator();
  });
});

qualitySlider.addEventListener('input', () => {
  qualityValue.textContent = qualitySlider.value;
  syncPresetIndicator();
});

unembedCheckbox.addEventListener('change', syncPresetIndicator);

// --- Helpers ---
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function showState(state) {
  dropZone.hidden = state !== 'idle';
  processingSection.hidden = state !== 'processing';
  resultsSection.hidden = state !== 'results';
}

function revokeBlobUrls() {
  blobUrls.forEach((url) => URL.revokeObjectURL(url));
  blobUrls = [];
}

// --- Worker management ---
function processFileWithProgress(file, options, progressCb) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    const reader = new FileReader();

    reader.onload = () => {
      const buffer = reader.result;
      worker.postMessage({ type: 'optimize', buffer, options }, [buffer]);
    };

    worker.onmessage = (e) => {
      const { type, progress, pass, result, stats, error } = e.data;
      if (type === 'progress') {
        progressCb(progress, pass);
      } else if (type === 'result') {
        worker.terminate();
        resolve({ result, stats });
      } else if (type === 'error') {
        worker.terminate();
        reject(new Error(error));
      }
    };

    worker.onerror = (err) => {
      worker.terminate();
      reject(err);
    };

    reader.readAsArrayBuffer(file);
  });
}

// --- Pass stats formatting ---
function formatPassStats(passStats) {
  if (!passStats) return '';
  const { name, error, ...rest } = passStats;
  if (error) return `${name}: error`;

  const parts = [];
  if (rest.recompressed != null && rest.recompressed > 0)
    parts.push(`${rest.recompressed} stream${rest.recompressed !== 1 ? 's' : ''} recompressed`);
  if (rest.converted != null && rest.converted > 0)
    parts.push(`${rest.converted} image${rest.converted !== 1 ? 's' : ''} converted to JPEG`);
  if (rest.unembedded != null && rest.unembedded > 0)
    parts.push(`${rest.unembedded} font${rest.unembedded !== 1 ? 's' : ''} unembedded`);
  if (rest.deduplicated != null && rest.deduplicated > 0)
    parts.push(`${rest.deduplicated} duplicate${rest.deduplicated !== 1 ? 's' : ''} removed`);
  if (rest.stripped != null && rest.stripped > 0)
    parts.push(`${rest.stripped} metadata entr${rest.stripped !== 1 ? 'ies' : 'y'} stripped`);
  if (rest.removed != null && rest.removed > 0)
    parts.push(`${rest.removed} unreferenced object${rest.removed !== 1 ? 's' : ''} removed`);

  return parts.length > 0 ? parts.join(', ') : null;
}

function buildStatsDetail(stats) {
  if (!stats?.passes) return null;
  const items = stats.passes
    .map((p) => {
      const text = formatPassStats(p);
      return text ? `<li class="pass-stats__item pass-stats__item--active">${text}</li>` : null;
    })
    .filter(Boolean);

  if (items.length === 0) return null;
  if (stats.sizeGuard) {
    items.push('<li class="pass-stats__item">Size guard: kept original (optimized was larger)</li>');
  }
  return `<ul class="pass-stats__list">${items.join('')}</ul>`;
}

// --- Main flow ---
async function handleFiles(files) {
  const pdfFiles = Array.from(files).filter(
    (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'),
  );
  if (pdfFiles.length === 0) return;

  const options = collectOptions();

  showState('processing');
  fileList.innerHTML = '';

  const results = [];

  for (const file of pdfFiles) {
    const li = document.createElement('li');
    li.className = 'file-item';
    li.innerHTML = `
      <span class="file-item__name">${file.name}</span>
      <span class="file-item__pass">Starting&hellip;</span>
      <div class="file-item__bar"><div class="file-item__fill" style="width:0%"></div></div>
    `;
    fileList.appendChild(li);

    const passEl = li.querySelector('.file-item__pass');
    const fillEl = li.querySelector('.file-item__fill');

    try {
      const { result, stats } = await processFileWithProgress(file, options, (progress, pass) => {
        fillEl.style.width = `${Math.round(progress * 100)}%`;
        passEl.textContent = pass || 'Processing\u2026';
      });

      fillEl.style.width = '100%';
      passEl.textContent = 'Done';

      results.push({ name: file.name, original: file.size, result, stats });
    } catch (err) {
      passEl.textContent = `Error: ${err.message}`;
      fillEl.style.width = '100%';
      fillEl.classList.add('file-item__fill--error');
    }
  }

  // Show results
  showState('results');
  resultsBody.innerHTML = '';
  revokeBlobUrls();

  for (const r of results) {
    const blob = new Blob([r.result], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    blobUrls.push(url);

    const saved = r.original - r.result.byteLength;
    const pct = r.original > 0 ? ((saved / r.original) * 100).toFixed(1) : '0.0';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.name}</td>
      <td>${formatSize(r.original)}</td>
      <td>${formatSize(r.result.byteLength)}</td>
      <td class="${saved > 0 ? 'saved--positive' : 'saved--zero'}">${saved > 0 ? '-' : ''}${pct}%</td>
      <td><a href="${url}" download="${r.name}" class="btn btn--small">Download</a></td>
    `;
    resultsBody.appendChild(tr);

    // Pass-level stats detail row
    const statsHtml = buildStatsDetail(r.stats);
    if (statsHtml) {
      const detailTr = document.createElement('tr');
      detailTr.className = 'pass-stats-row';
      const detailTd = document.createElement('td');
      detailTd.colSpan = 5;
      detailTd.innerHTML = `
        <button class="pass-stats-toggle">Show details</button>
        <div class="pass-stats" hidden>${statsHtml}</div>
      `;
      detailTr.appendChild(detailTd);
      resultsBody.appendChild(detailTr);

      const toggleBtn = detailTd.querySelector('.pass-stats-toggle');
      const statsDiv = detailTd.querySelector('.pass-stats');
      toggleBtn.addEventListener('click', () => {
        const visible = !statsDiv.hidden;
        statsDiv.hidden = visible;
        toggleBtn.textContent = visible ? 'Show details' : 'Hide details';
      });
    }
  }

  btnDownloadAll.hidden = results.length <= 1;
  btnDownloadAll.onclick = () => {
    for (const r of results) {
      const blob = new Blob([r.result], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = r.name;
      a.click();
      URL.revokeObjectURL(url);
    }
  };
}

// --- Event listeners ---
dropArea.addEventListener('click', () => fileInput.click());
dropArea.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});

fileInput.addEventListener('change', (e) => {
  if (e.target.files.length) handleFiles(e.target.files);
});

dropArea.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropArea.classList.add('drop-area--active');
});

dropArea.addEventListener('dragleave', () => {
  dropArea.classList.remove('drop-area--active');
});

dropArea.addEventListener('drop', (e) => {
  e.preventDefault();
  dropArea.classList.remove('drop-area--active');
  if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
});

btnStartOver.addEventListener('click', () => {
  revokeBlobUrls();
  fileInput.value = '';
  showState('idle');
});

showState('idle');

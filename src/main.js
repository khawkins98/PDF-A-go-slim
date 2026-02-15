import './style.css';
import { formatSize } from './ui/helpers.js';
import { collectOptions, applyPreset, initOptionsListeners, getCurrentPresetLabel } from './ui/options.js';
import { buildSingleFileCard, buildSummaryCard, buildFileCard } from './ui/result-card.js';
import { destroyAllComparisons } from './ui/compare.js';

// --- Friendly pass name labels (pipeline names stay unchanged for test compat) ---
const PASS_LABELS = {
  'Recompressing streams': 'Compressing data\u2026',
  'Recompressing images': 'Optimizing images\u2026',
  'Unembedding standard fonts': 'Cleaning up fonts\u2026',
  'Subsetting fonts': 'Optimizing fonts\u2026',
  'Deduplicating objects': 'Removing duplicates\u2026',
  'Deduplicating fonts': 'Consolidating fonts\u2026',
  'Stripping metadata': 'Cleaning metadata\u2026',
  'Removing unreferenced objects': 'Final cleanup\u2026',
};

// --- Friendly error messages ---
function friendlyError(msg) {
  const lower = (msg || '').toLowerCase();
  if (lower.includes('encrypt') || lower.includes('password'))
    return 'This PDF is password-protected';
  if (lower.includes('invalid pdf') || lower.includes('not a valid'))
    return "This file doesn't appear to be a valid PDF";
  return 'Something went wrong processing this file';
}

// --- Toast notification ---
function showToast(message, duration = 4000) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('toast--fading');
    toast.addEventListener('transitionend', () => toast.remove());
  }, duration);
}

// --- Count-up animation ---
function animateCountUp(el, target, duration = 600) {
  const start = performance.now();
  const update = (now) => {
    const t = Math.min((now - start) / duration, 1);
    const eased = 1 - (1 - t) ** 3; // ease-out cubic
    el.textContent = `-${(eased * target).toFixed(1)}%`;
    if (t < 1) requestAnimationFrame(update);
  };
  requestAnimationFrame(update);
}

// --- State ---
let blobUrls = [];
let lastFiles = null;
let lastRunOptions = null;
let activeWorker = null;
let cancelled = false;

// --- DOM refs ---
const dropZone = document.getElementById('drop-zone');
const dropArea = dropZone.querySelector('.drop-area');
const fileInput = document.getElementById('file-input');
const processingSection = document.getElementById('processing');
const fileList = document.getElementById('file-list');
const resultsSection = document.getElementById('results');
const resultsSummary = document.getElementById('results-summary');
const resultsFiles = document.getElementById('results-files');
const resultsSettingsBar = document.getElementById('results-settings');
const settingsPresetLabel = document.getElementById('settings-preset-label');
const btnToggleSettings = document.getElementById('btn-toggle-settings');
const resultsSettingsBody = document.getElementById('results-settings-body');
const optionsIdleSlot = document.getElementById('options-idle-slot');
const btnReoptimize = document.getElementById('btn-reoptimize');
const btnStartOver = document.getElementById('btn-start-over');
const dropOverlay = document.getElementById('drop-overlay');
const btnCancel = document.getElementById('btn-cancel');

// --- Settings bar toggle ---
btnToggleSettings.addEventListener('click', () => {
  const isOpen = !resultsSettingsBody.hidden;
  resultsSettingsBody.hidden = isOpen;
  btnToggleSettings.textContent = isOpen ? 'Change settings' : 'Hide settings';
});

// --- Stale results detection ---
function checkStaleResults() {
  if (!lastRunOptions || resultsSection.hidden) return;
  const current = JSON.stringify(collectOptions());
  const isStale = current !== lastRunOptions;

  btnReoptimize.classList.toggle('btn--stale', isStale);
  resultsSettingsBar.classList.toggle('results-settings--stale', isStale);

  // Update the preset label
  settingsPresetLabel.textContent = getCurrentPresetLabel();
}

// --- Initialize options panel listeners ---
initOptionsListeners({ onOptionsChanged: checkStaleResults });

// --- Helpers ---
function showState(state) {
  dropZone.hidden = state !== 'idle';
  processingSection.hidden = state !== 'processing';
  resultsSection.hidden = state !== 'results';

  const optionsPanel = document.getElementById('options-panel');

  if (state === 'idle') {
    // Move options panel back to idle slot
    optionsPanel.hidden = false;
    optionsIdleSlot.appendChild(optionsPanel);
  } else if (state === 'processing') {
    optionsPanel.hidden = true;
  } else if (state === 'results') {
    // Move options panel into settings bar body
    optionsPanel.hidden = false;
    const adv = optionsPanel.querySelector('.advanced');
    if (adv) adv.open = false;
    resultsSettingsBody.appendChild(optionsPanel);
    resultsSettingsBody.hidden = true;
    btnToggleSettings.textContent = 'Change settings';
    settingsPresetLabel.textContent = getCurrentPresetLabel();
  }

  // Animate the entering section
  const active = state === 'idle' ? dropZone : state === 'processing' ? processingSection : resultsSection;
  active.classList.remove('state--entering');
  void active.offsetWidth;
  active.classList.add('state--entering');
}

function revokeBlobUrls() {
  blobUrls.forEach((url) => URL.revokeObjectURL(url));
  blobUrls = [];
}

// --- Worker management ---
function processFileWithProgress(file, options, progressCb) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    activeWorker = worker;
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
        activeWorker = null;
        worker.terminate();
        resolve({ result, stats });
      } else if (type === 'error') {
        activeWorker = null;
        worker.terminate();
        reject(new Error(error));
      }
    };

    worker.onerror = (err) => {
      activeWorker = null;
      worker.terminate();
      reject(err);
    };

    reader.readAsArrayBuffer(file);
  });
}

// --- Render results ---
function renderResults(results, options) {
  resultsSummary.innerHTML = '';
  resultsFiles.innerHTML = '';

  if (results.length === 1) {
    // Single file: one full result card
    const r = results[0];
    const blob = new Blob([r.result], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    blobUrls.push(url);

    const card = buildSingleFileCard(r, blob, url, options, animateCountUp, checkStaleResults);
    resultsSummary.appendChild(card);
  } else {
    // Multi-file: summary card + per-file cards
    const summaryCard = buildSummaryCard(results, animateCountUp);
    resultsSummary.appendChild(summaryCard);

    for (const r of results) {
      const blob = new Blob([r.result], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      blobUrls.push(url);

      const card = buildFileCard(r, blob, url, options, checkStaleResults);
      resultsFiles.appendChild(card);
    }
  }
}

// --- Main flow ---
async function handleFiles(files) {
  const allFiles = Array.from(files);
  const pdfFiles = allFiles.filter(
    (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'),
  );
  const skipped = allFiles.length - pdfFiles.length;
  if (skipped > 0) {
    showToast(`Only PDF files are supported. ${skipped} file${skipped > 1 ? 's' : ''} skipped.`);
  }
  if (pdfFiles.length === 0) return;

  lastFiles = pdfFiles;
  cancelled = false;

  const options = collectOptions();
  lastRunOptions = JSON.stringify(options);

  showState('processing');
  const processingStart = Date.now();
  fileList.innerHTML = '';

  const results = [];

  for (const file of pdfFiles) {
    if (cancelled) break;

    const li = document.createElement('li');
    li.className = 'file-item';
    li.innerHTML = `
      <span class="file-item__name">${file.name}</span>
      <span class="file-item__pass">Starting&hellip;</span>
      <div class="file-item__bar"><div class="file-item__fill file-item__fill--active" style="width:0%"></div></div>
    `;
    fileList.appendChild(li);

    const passEl = li.querySelector('.file-item__pass');
    const fillEl = li.querySelector('.file-item__fill');

    try {
      const { result, stats } = await processFileWithProgress(file, options, (progress, pass) => {
        fillEl.style.width = `${Math.round(progress * 100)}%`;
        passEl.textContent = PASS_LABELS[pass] || pass || 'Processing\u2026';
      });

      fillEl.style.width = '100%';
      fillEl.classList.remove('file-item__fill--active');
      passEl.textContent = 'Done';

      results.push({ name: file.name, originalFile: file, original: file.size, result, stats });
    } catch (err) {
      if (cancelled) break;
      fillEl.classList.remove('file-item__fill--active');
      fillEl.style.width = '100%';
      fillEl.classList.add('file-item__fill--error');

      passEl.innerHTML = '';
      const errorSpan = document.createElement('span');
      errorSpan.className = 'file-item__error';
      errorSpan.textContent = friendlyError(err.message);
      passEl.appendChild(errorSpan);

      const retryBtn = document.createElement('button');
      retryBtn.className = 'file-item__retry';
      retryBtn.textContent = 'Retry';
      retryBtn.addEventListener('click', () => {
        li.remove();
        handleFiles([file]);
      });
      passEl.appendChild(retryBtn);
    }
  }

  if (cancelled) {
    showState('idle');
    return;
  }

  // Ensure processing state is visible for at least 800ms
  const elapsed = Date.now() - processingStart;
  if (elapsed < 800) {
    await new Promise((r) => setTimeout(r, 800 - elapsed));
  }

  // Show results
  showState('results');
  revokeBlobUrls();
  destroyAllComparisons();

  btnReoptimize.classList.remove('btn--stale');
  resultsSettingsBar.classList.remove('results-settings--stale');

  renderResults(results, options);
}

// --- Example PDF ---
const EXAMPLE_PDF_URL = 'https://raw.githubusercontent.com/mozilla/pdf.js/master/test/pdfs/tracemonkey.pdf';
const btnTryExample = document.getElementById('btn-try-example');

btnTryExample.addEventListener('click', async (e) => {
  e.stopPropagation(); // Don't trigger the file picker
  btnTryExample.disabled = true;
  btnTryExample.textContent = 'loading\u2026';
  try {
    const res = await fetch(EXAMPLE_PDF_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const file = new File([blob], 'tracemonkey.pdf', { type: 'application/pdf' });
    handleFiles([file]);
  } catch (err) {
    btnTryExample.textContent = 'failed to load';
    console.error('Example PDF fetch failed:', err);
  }
});

// --- Event listeners ---
dropArea.addEventListener('click', (e) => {
  // Don't open file picker if the example button was clicked
  if (e.target.closest('#btn-try-example')) return;
  fileInput.click();
});
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

// --- Full-page drop overlay ---
let dragCounter = 0;

document.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer.types.includes('Files')) return;
  // Only show overlay when not processing
  if (!processingSection.hidden) return;
  dragCounter++;
  if (dragCounter === 1) {
    dropOverlay.hidden = false;
  }
});

document.addEventListener('dragleave', () => {
  dragCounter--;
  if (dragCounter <= 0) {
    dragCounter = 0;
    dropOverlay.hidden = true;
  }
});

document.addEventListener('dragover', (e) => {
  e.preventDefault();
});

document.addEventListener('drop', (e) => {
  e.preventDefault();
  dragCounter = 0;
  dropOverlay.hidden = true;
  if (!processingSection.hidden) return;
  if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
});

// --- Cancel button ---
btnCancel.addEventListener('click', () => {
  cancelled = true;
  if (activeWorker) {
    activeWorker.terminate();
    activeWorker = null;
  }
  showState('idle');
});

btnReoptimize.addEventListener('click', () => {
  if (lastFiles) handleFiles(lastFiles);
});

btnStartOver.addEventListener('click', () => {
  revokeBlobUrls();
  destroyAllComparisons();
  lastFiles = null;
  lastRunOptions = null;
  fileInput.value = '';
  btnReoptimize.classList.remove('btn--stale');
  resultsSettingsBar.classList.remove('results-settings--stale');
  showState('idle');
});

// --- Debug mode indicator ---
if (new URLSearchParams(window.location.search).has('debug')) {
  const banner = document.createElement('div');
  banner.className = 'debug-banner';
  banner.innerHTML = 'Debug mode active — extra diagnostics will appear in results';
  document.body.insertBefore(banner, document.body.firstChild);
}

showState('idle');

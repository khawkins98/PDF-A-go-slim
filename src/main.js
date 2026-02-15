import './style.css';
import { formatSize } from './ui/helpers.js';
import { collectOptions, initOptionsListeners, getCurrentPresetLabel } from './ui/options.js';
import { buildResultsPaletteContent, buildInspectorPaletteContent } from './ui/result-card.js';
import { buildPreviewContent, destroyAllComparisons } from './ui/compare.js';
import { initWindowManager, createPalette, initDrag } from './ui/palette.js';

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
const dropOverlay = document.getElementById('drop-overlay');
const btnCancel = document.getElementById('btn-cancel');
const statusLeft = document.getElementById('status-left');

// --- Initialize window manager ---
initWindowManager();

// Make main window draggable + shadable
const mainWindow = document.getElementById('main-window');
const mainTitleBar = mainWindow.querySelector('.title-bar');
initDrag(mainWindow, mainTitleBar);

const mainCollapseBox = mainTitleBar.querySelector('.title-bar__collapse-box');
function toggleMainShade() {
  mainWindow.classList.toggle('app-window--shaded');
}
mainTitleBar.addEventListener('dblclick', toggleMainShade);
if (mainCollapseBox) {
  mainCollapseBox.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMainShade();
  });
}

// --- Create palettes ---
const settingsPalette = createPalette({
  id: 'settings',
  title: 'Settings',
  defaultPosition: { top: 20, left: 520 },
  width: 260,
});

const resultsPalette = createPalette({
  id: 'results',
  title: 'Results',
  defaultPosition: { top: 110, left: 520 },
  width: 260,
});

const inspectorPalette = createPalette({
  id: 'inspector',
  title: 'Inspector',
  defaultPosition: { top: 320, left: 20 },
  width: 480,
});

const previewPalette = createPalette({
  id: 'preview',
  title: 'Preview',
  defaultPosition: { top: 280, left: 520 },
  width: 400,
});

// Move #options-panel into Settings palette
const optionsPanel = document.getElementById('options-panel');
optionsPanel.hidden = false;
settingsPalette.setContent(optionsPanel);

// Set empty states for result palettes
resultsPalette.showEmpty('Drop a PDF to see results');
inspectorPalette.showEmpty('Drop a PDF to see object breakdown');
previewPalette.showEmpty('Drop a PDF to see preview');

// --- Stale results detection ---
function checkStaleResults() {
  if (!lastRunOptions) return;
  const current = JSON.stringify(collectOptions());
  const isStale = current !== lastRunOptions;
  const btn = document.getElementById('btn-reoptimize');
  if (btn) btn.classList.toggle('btn--stale', isStale);
}

// --- Initialize options panel listeners ---
initOptionsListeners({ onOptionsChanged: checkStaleResults });

// --- Simple state management (no more showState) ---
function setProcessing(active) {
  processingSection.hidden = !active;
  dropZone.classList.toggle('state--dimmed', active);
  statusLeft.textContent = active
    ? 'Optimizing\u2026'
    : 'Reduce PDF file size \u2014 files never leave your device';
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

// --- Render results into palettes ---
function renderResults(results, options) {
  // Update status bar with savings summary
  const totalOriginal = results.reduce((s, r) => s + r.original, 0);
  const totalOptimized = results.reduce((s, r) => s + r.result.byteLength, 0);
  const totalSaved = totalOriginal - totalOptimized;
  const totalPct = totalOriginal > 0 ? ((totalSaved / totalOriginal) * 100).toFixed(1) : '0.0';
  if (totalSaved > 0) {
    statusLeft.textContent = `Saved ${totalPct}% \u2014 ${formatSize(totalOriginal)} \u2192 ${formatSize(totalOptimized)}`;
  } else {
    statusLeft.textContent = 'Done \u2014 no size reduction';
  }

  // Results palette
  const resultsContent = buildResultsPaletteContent(results, blobUrls, options, {
    animateCountUp,
    onStaleCheck: checkStaleResults,
    onReoptimize: () => { if (lastFiles) handleFiles(lastFiles); },
    onStartOver: startOver,
  });
  resultsPalette.setContent(resultsContent);

  // Inspector palette (use first result for single-file, or first for multi — user sees summary in results)
  const firstResult = results[0];
  const inspectorContent = buildInspectorPaletteContent(firstResult, options);
  if (inspectorContent) {
    inspectorPalette.setContent(inspectorContent);
  } else {
    inspectorPalette.showEmpty('No optimization data available');
  }

  // Preview palette (single-file: auto-load, multi-file: first file)
  const previewResult = results[0];
  const blob = new Blob([previewResult.result], { type: 'application/pdf' });
  const previewContent = buildPreviewContent(previewResult.originalFile, blob);
  previewPalette.setContent(previewContent);
}

// --- Start over ---
function startOver() {
  revokeBlobUrls();
  destroyAllComparisons();
  lastFiles = null;
  lastRunOptions = null;
  fileInput.value = '';

  resultsPalette.showEmpty('Drop a PDF to see results');
  inspectorPalette.showEmpty('Drop a PDF to see object breakdown');
  previewPalette.showEmpty('Drop a PDF to see preview');

  statusLeft.textContent = 'Reduce PDF file size \u2014 files never leave your device';
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

  setProcessing(true);
  const processingStart = Date.now();
  fileList.innerHTML = '';

  const results = [];

  for (let fileIdx = 0; fileIdx < pdfFiles.length; fileIdx++) {
    const file = pdfFiles[fileIdx];
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
    const fileCounter = pdfFiles.length > 1 ? ` (${fileIdx + 1}/${pdfFiles.length})` : '';
    statusLeft.textContent = `Optimizing ${file.name}${fileCounter}\u2026`;

    try {
      const { result, stats } = await processFileWithProgress(file, options, (progress, pass) => {
        fillEl.style.width = `${Math.round(progress * 100)}%`;
        const passLabel = PASS_LABELS[pass] || pass || 'Processing\u2026';
        passEl.textContent = passLabel;
        statusLeft.textContent = `Optimizing ${file.name}${fileCounter} \u2014 ${passLabel}`;
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
    setProcessing(false);
    return;
  }

  // Ensure processing state is visible for at least 800ms
  const elapsed = Date.now() - processingStart;
  if (elapsed < 800) {
    await new Promise((r) => setTimeout(r, 800 - elapsed));
  }

  // Show results
  setProcessing(false);
  revokeBlobUrls();
  destroyAllComparisons();

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
  setProcessing(false);
});

// --- Debug mode indicator ---
if (new URLSearchParams(window.location.search).has('debug')) {
  const banner = document.createElement('div');
  banner.className = 'debug-banner';
  banner.innerHTML = 'Debug mode active \u2014 extra diagnostics will appear in results';
  const appWindow = document.querySelector('.app-window');
  appWindow.insertBefore(banner, appWindow.firstChild);
}

// --- Initial state ---
statusLeft.textContent = 'Reduce PDF file size \u2014 files never leave your device';

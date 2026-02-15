import './style.css';
import { formatSize, escapeHtml, renderMarkdown } from './ui/helpers.js';
import { collectOptions, initOptionsListeners } from './ui/options.js';
import { buildResultsPaletteContent, buildInspectorPaletteContent } from './ui/result-card.js';
import { buildPreviewContent, destroyAllComparisons } from './ui/compare.js';
import { initWindowManager, createPalette, initDrag, bringToFront } from './ui/palette.js';
import { createControlStrip } from './ui/control-strip.js';
import { buildAppearanceContent, initAppearance, playStartupChime, showHappyMac, showSadMac } from './ui/appearance.js';
import readmeText from '../README.md?raw';

// --- Sample PDFs (pdf.js test suite — CORS-accessible via GitHub raw) ---
const SAMPLE_PDF_BASE = 'https://raw.githubusercontent.com/mozilla/pdf.js/master/test/pdfs/';
const SAMPLE_PDFS = [
  { name: 'tracemonkey.pdf', label: 'Research Paper', url: `${SAMPLE_PDF_BASE}tracemonkey.pdf` },
  { name: 'TAMReview.pdf', label: 'TAM Review', url: `${SAMPLE_PDF_BASE}TAMReview.pdf` },
  { name: 'calrgb.pdf', label: 'Color Graphics', url: `${SAMPLE_PDF_BASE}calrgb.pdf` },
];

async function fetchPdfAsFile(url, name) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  return new File([blob], name, { type: 'application/pdf' });
}

// Suppress benign ResizeObserver loop error (triggered by viewer resize ↔ layout cycle)
window.addEventListener('error', (e) => {
  if (e.message?.includes('ResizeObserver loop')) e.stopImmediatePropagation();
});

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
let hasPlayedChime = false;

// --- DOM refs ---
const dropZone = document.getElementById('drop-zone');
const dropArea = dropZone.querySelector('.drop-area');
const fileInput = document.getElementById('file-input');
const processingSection = document.getElementById('processing');
const fileList = document.getElementById('file-list');
const dropOverlay = document.getElementById('drop-overlay');
const btnCancel = document.getElementById('btn-cancel');
const mainActions = document.getElementById('main-actions');
const btnStartOver = document.getElementById('btn-start-over');
const settingsActions = document.getElementById('settings-actions');
const btnReoptimize = document.getElementById('btn-reoptimize');
const statusLeft = document.getElementById('status-left');

// --- Initialize window manager ---
initWindowManager();
initAppearance();

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
  width: 600,
});
// Set an initial height so the viewer favors landscape proportions.
// CSS resize:both lets the user adjust from here.
previewPalette.element.style.height = '460px';

// Move #options-panel into Settings palette
const optionsPanel = document.getElementById('options-panel');
optionsPanel.hidden = false;
settingsPalette.setContent(optionsPanel);

// Set empty states for result palettes
resultsPalette.showEmpty('Nothing to report yet');
inspectorPalette.showEmpty('Waiting for a PDF to dissect');
previewPalette.showEmpty('No document loaded');

// --- Read Me palette (Mac Stickies style, open by default) ---
const readmePalette = createPalette({
  id: 'readme',
  title: 'Read Me',
  defaultPosition: { top: 400, left: 20 },
  width: 340,
  closable: true,
});
readmePalette.element.classList.add('palette--sticky');

const readmeContent = document.createElement('div');
readmeContent.className = 'readme-content';
readmeContent.innerHTML = renderMarkdown(readmeText);
readmePalette.setContent(readmeContent);

// --- Appearance palette (hidden by default, closable) ---
const appearancePalette = createPalette({
  id: 'appearance',
  title: 'Appearance',
  defaultPosition: { top: 200, left: 520 },
  width: 240,
  closable: true,
});
appearancePalette.setContent(buildAppearanceContent());
appearancePalette.hide();

// Establish initial z-order: Read Me behind work palettes
bringToFront(readmePalette.element);
bringToFront(settingsPalette.element);
bringToFront(resultsPalette.element);
bringToFront(previewPalette.element);
bringToFront(inspectorPalette.element);

function toggleAppearancePalette() {
  if (appearancePalette.element.hidden) {
    appearancePalette.show();
  }
  bringToFront(appearancePalette.element);
}

// --- Desktop icon handlers ---
document.getElementById('icon-readme').addEventListener('click', () => {
  if (readmePalette.element.hidden) readmePalette.show();
  bringToFront(readmePalette.element);
});

document.getElementById('icon-appearance').addEventListener('click', toggleAppearancePalette);

// --- Sample PDF desktop icons (drag-to-optimize) ---
const SAMPLE_TYPE = 'application/x-pdf-sample';
const desktopIcons = document.getElementById('desktop-icons');

// PDF document SVG icon (shared across sample icons)
const pdfIconSvg = `<svg class="desktop-icon__img" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
  <polyline points="14 2 14 8 20 8"/>
  <text x="12" y="17" text-anchor="middle" font-size="6" font-weight="bold" fill="currentColor" stroke="none">PDF</text>
</svg>`;

SAMPLE_PDFS.forEach((sample) => {
  const icon = document.createElement('button');
  icon.type = 'button';
  icon.className = 'desktop-icon desktop-icon--sample';
  icon.draggable = true;
  icon.innerHTML = `${pdfIconSvg}<span class="desktop-icon__label">${escapeHtml(sample.label)}</span>`;

  // Drag: set custom type so drop handlers can distinguish from native file drags
  icon.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData(SAMPLE_TYPE, JSON.stringify({ name: sample.name, url: sample.url }));
    e.dataTransfer.effectAllowed = 'copy';
  });

  // Click fallback: fetch + optimize directly
  icon.addEventListener('click', async () => {
    if (icon.classList.contains('desktop-icon--loading')) return;
    const labelEl = icon.querySelector('.desktop-icon__label');
    const originalLabel = labelEl.textContent;
    icon.classList.add('desktop-icon--loading');
    labelEl.textContent = 'Loading\u2026';
    try {
      const file = await fetchPdfAsFile(sample.url, sample.name);
      await handleFiles([file]);
    } catch (err) {
      console.error(`Sample PDF fetch failed (${sample.name}):`, err);
    } finally {
      icon.classList.remove('desktop-icon--loading');
      labelEl.textContent = originalLabel;
    }
  });

  desktopIcons.appendChild(icon);
});

// --- Stale results detection ---
function checkStaleResults() {
  if (!lastRunOptions) return;
  const current = JSON.stringify(collectOptions());
  const isStale = current !== lastRunOptions;
  btnReoptimize.classList.toggle('btn--stale', isStale);
}

// --- Control Strip ---
const controlStrip = createControlStrip({
  onPresetChange: checkStaleResults,
  onAboutClick: showAboutDialog,
  onAppearanceClick: toggleAppearancePalette,
});

// --- Initialize options panel listeners ---
initOptionsListeners({
  onOptionsChanged: () => {
    checkStaleResults();
    controlStrip.updatePresetIndicator();
  },
});

// --- Simple state management (no more showState) ---
function setProcessing(active) {
  processingSection.hidden = !active;
  dropZone.classList.toggle('state--dimmed', active);
  statusLeft.textContent = active
    ? 'Optimizing\u2026'
    : 'Ready \u2014 files never leave your device';
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
    statusLeft.textContent = 'Done \u2014 already well-optimized';
  }

  // Results palette
  const resultsContent = buildResultsPaletteContent(results, blobUrls, options, {
    animateCountUp,
    onStaleCheck: checkStaleResults,
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

  // Show action buttons
  mainActions.hidden = false;
  settingsActions.hidden = false;

  // Easter egg hooks
  const savingsPct = totalOriginal > 0 ? (totalSaved / totalOriginal) * 100 : 0;
  const savingsInfo = { pct: totalPct, original: formatSize(totalOriginal), optimized: formatSize(totalOptimized), saved: formatSize(totalSaved), savedBytes: totalSaved };
  if (savingsPct >= 30) showHappyMac(savingsInfo);
  if (savingsPct <= 0) showSadMac(savingsInfo);
}

// --- Start over ---
function startOver() {
  revokeBlobUrls();
  destroyAllComparisons();
  lastFiles = null;
  lastRunOptions = null;
  fileInput.value = '';

  resultsPalette.showEmpty('Nothing to report yet');
  inspectorPalette.showEmpty('Waiting for a PDF to dissect');
  previewPalette.showEmpty('No document loaded');

  mainActions.hidden = true;
  settingsActions.hidden = true;
  btnReoptimize.classList.remove('btn--stale');
  statusLeft.textContent = 'Ready \u2014 files never leave your device';
}

btnStartOver.addEventListener('click', startOver);
btnReoptimize.addEventListener('click', () => { if (lastFiles) handleFiles(lastFiles); });

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

  // Easter egg: one-shot startup chime on first file drop
  if (!hasPlayedChime) {
    hasPlayedChime = true;
    playStartupChime();
  }

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
      <span class="file-item__name">${escapeHtml(file.name)}</span>
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

// --- Example PDF (inline "try an example" button) ---
const btnTryExample = document.getElementById('btn-try-example');

btnTryExample.addEventListener('click', async (e) => {
  e.stopPropagation(); // Don't trigger the file picker
  btnTryExample.disabled = true;
  btnTryExample.textContent = 'loading\u2026';
  try {
    const file = await fetchPdfAsFile(SAMPLE_PDFS[0].url, SAMPLE_PDFS[0].name);
    await handleFiles([file]);
  } catch (err) {
    console.error('Example PDF fetch failed:', err);
  } finally {
    btnTryExample.disabled = false;
    btnTryExample.textContent = 'try an example PDF';
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

dropArea.addEventListener('drop', async (e) => {
  e.preventDefault();
  dropArea.classList.remove('drop-area--active');
  const sampleData = e.dataTransfer.getData(SAMPLE_TYPE);
  if (sampleData) {
    try {
      const { name, url } = JSON.parse(sampleData);
      const file = await fetchPdfAsFile(url, name);
      await handleFiles([file]);
    } catch (err) {
      console.error('Sample PDF drop failed:', err);
    }
    return;
  }
  if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
});

// --- Full-page drop overlay ---
let dragCounter = 0;

document.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer.types.includes('Files') && !e.dataTransfer.types.includes(SAMPLE_TYPE)) return;
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

document.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragCounter = 0;
  dropOverlay.hidden = true;
  if (!processingSection.hidden) return;
  const sampleData = e.dataTransfer.getData(SAMPLE_TYPE);
  if (sampleData) {
    try {
      const { name, url } = JSON.parse(sampleData);
      const file = await fetchPdfAsFile(url, name);
      await handleFiles([file]);
    } catch (err) {
      console.error('Sample PDF drop failed:', err);
    }
    return;
  }
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

// --- About dialog ---
function showAboutDialog() {
  const overlay = document.createElement('div');
  overlay.className = 'about-overlay';
  overlay.innerHTML = `
    <div class="about-dialog">
      <div class="about-dialog__title-bar">
        <div class="about-dialog__close-box" data-action="close"></div>
        <div class="about-dialog__stripes"></div>
        <span class="about-dialog__title">About</span>
        <div class="about-dialog__stripes"></div>
      </div>
      <div class="about-dialog__body">
        <div class="about-dialog__name">PDF-A-go-slim</div>
        <p>Reduce PDF file size entirely in your browser. No uploads, no server.</p>
        <p>Built with pdf-lib, fflate, harfbuzzjs, and jpeg-js.</p>
        <p><a href="https://github.com/khawkins98/PDF-A-go-slim" target="_blank" rel="noopener">github.com/khawkins98/PDF-A-go-slim</a></p>
      </div>
      <div class="about-dialog__footer">
        <button class="btn btn--default" data-action="close">OK</button>
      </div>
    </div>`;

  function close() { overlay.remove(); }
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('[data-action="close"]')) close();
  });
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
  });
  document.body.appendChild(overlay);
}

document.getElementById('btn-about').addEventListener('click', showAboutDialog);

// --- Debug mode indicator ---
if (new URLSearchParams(window.location.search).has('debug')) {
  const banner = document.createElement('div');
  banner.className = 'debug-banner';
  banner.innerHTML = 'Debug mode active \u2014 extra diagnostics will appear in results';
  const appWindow = document.querySelector('.app-window');
  appWindow.insertBefore(banner, appWindow.firstChild);
}

// --- Initial state ---
statusLeft.textContent = 'Ready \u2014 files never leave your device';

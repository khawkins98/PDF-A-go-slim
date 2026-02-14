import './style.css';
import { formatSize } from './ui/helpers.js';
import { collectOptions, applyPreset, initOptionsListeners } from './ui/options.js';
import { buildInspectPanel } from './ui/inspector.js';
import { buildStatsDetail, buildDebugPanel } from './ui/stats.js';
import { buildCompareRow, destroyAllComparisons } from './ui/compare.js';

// --- State ---
let blobUrls = [];
let lastFiles = null;
let lastRunOptions = null;

// --- DOM refs ---
const dropZone = document.getElementById('drop-zone');
const dropArea = dropZone.querySelector('.drop-area');
const fileInput = document.getElementById('file-input');
const processingSection = document.getElementById('processing');
const fileList = document.getElementById('file-list');
const resultsSection = document.getElementById('results');
const resultsBody = document.getElementById('results-body');
const btnReoptimize = document.getElementById('btn-reoptimize');
const btnStartOver = document.getElementById('btn-start-over');

// --- Stale results detection ---
function checkStaleResults() {
  if (!lastRunOptions || resultsSection.hidden) return;
  const current = JSON.stringify(collectOptions());
  const isStale = current !== lastRunOptions;

  btnReoptimize.classList.toggle('btn--stale', isStale);

  const existing = resultsSection.querySelector('.stale-banner');
  if (isStale && !existing) {
    const banner = document.createElement('div');
    banner.className = 'stale-banner';
    banner.textContent = 'Settings changed \u2014 re-optimize to see updated results';
    resultsSection.insertBefore(banner, resultsSection.querySelector('.results-hero') || resultsSection.querySelector('.results-table'));
  } else if (!isStale && existing) {
    existing.remove();
  }
}

// --- Initialize options panel listeners ---
initOptionsListeners({ onOptionsChanged: checkStaleResults });

// --- Helpers ---
function showState(state) {
  dropZone.hidden = state !== 'idle';
  processingSection.hidden = state !== 'processing';
  resultsSection.hidden = state !== 'results';
  const optionsPanel = document.getElementById('options-panel');
  optionsPanel.hidden = state === 'processing';

  // Auto-collapse Advanced Settings when showing results
  if (state === 'results') {
    const adv = optionsPanel.querySelector('.advanced');
    if (adv) adv.open = false;
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

// --- Main flow ---
async function handleFiles(files) {
  const pdfFiles = Array.from(files).filter(
    (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'),
  );
  if (pdfFiles.length === 0) return;

  lastFiles = pdfFiles;

  const options = collectOptions();
  lastRunOptions = JSON.stringify(options);

  showState('processing');
  const processingStart = Date.now();
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

      results.push({ name: file.name, originalFile: file, original: file.size, result, stats });
    } catch (err) {
      passEl.textContent = `Error: ${err.message}`;
      fillEl.style.width = '100%';
      fillEl.classList.add('file-item__fill--error');
    }
  }

  // Ensure processing state is visible for at least 800ms
  const elapsed = Date.now() - processingStart;
  if (elapsed < 800) {
    await new Promise((r) => setTimeout(r, 800 - elapsed));
  }

  // Show results
  showState('results');
  resultsBody.innerHTML = '';
  revokeBlobUrls();
  destroyAllComparisons();

  // Clear any stale banner / hero card from previous run
  const staleBanner = resultsSection.querySelector('.stale-banner');
  if (staleBanner) staleBanner.remove();
  const oldHero = resultsSection.querySelector('.results-hero');
  if (oldHero) oldHero.remove();
  btnReoptimize.classList.remove('btn--stale');

  for (const r of results) {
    const blob = new Blob([r.result], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    blobUrls.push(url);

    const saved = r.original - r.result.byteLength;
    const pct = r.original > 0 ? ((saved / r.original) * 100).toFixed(1) : '0.0';
    const savedText = saved > 0 ? `-${pct}% (${formatSize(saved)})` : `${pct}%`;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.name}</td>
      <td>${formatSize(r.original)}</td>
      <td>${formatSize(r.result.byteLength)}</td>
      <td class="${saved > 0 ? 'saved--positive' : 'saved--zero'}">${savedText}</td>
      <td><a href="${url}" download="${r.name}" class="btn btn--primary btn--small">Download</a></td>
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
        toggleBtn.classList.toggle('toggle--open', !visible);
      });
    }

    // Object inspector row
    const inspectHtml = buildInspectPanel(r.stats);
    if (inspectHtml) {
      const inspectTr = document.createElement('tr');
      inspectTr.className = 'inspect-row';
      const inspectTd = document.createElement('td');
      inspectTd.colSpan = 5;
      inspectTd.innerHTML = `
        <button class="inspect-toggle">Object breakdown</button>
        <div class="inspect-detail" hidden>${inspectHtml}</div>
      `;
      inspectTr.appendChild(inspectTd);
      resultsBody.appendChild(inspectTr);

      const inspectBtn = inspectTd.querySelector('.inspect-toggle');
      const inspectDiv = inspectTd.querySelector('.inspect-detail');
      inspectBtn.addEventListener('click', () => {
        const visible = !inspectDiv.hidden;
        inspectDiv.hidden = visible;
        inspectBtn.textContent = visible ? 'Object breakdown' : 'Hide breakdown';
        inspectBtn.classList.toggle('toggle--open', !visible);
      });

      // Delegated handler for "Show more..." toggles
      inspectDiv.addEventListener('click', (ev) => {
        const btn = ev.target.closest('.inspect-show-more');
        if (!btn) return;
        const collapsed = btn.previousElementSibling;
        if (collapsed && collapsed.classList.contains('inspect-collapse')) {
          collapsed.hidden = !collapsed.hidden;
          btn.textContent = collapsed.hidden
            ? `Show ${btn.dataset.count} more\u2026`
            : 'Show less';
        }
      });
    }

    // Compare row
    const compareTr = buildCompareRow(r.originalFile, blob);
    resultsBody.appendChild(compareTr);

    // Debug panel (only when ?debug URL param is present)
    if (options.debug) {
      const debugHtml = buildDebugPanel(r.stats);
      if (debugHtml) {
        const debugTr = document.createElement('tr');
        debugTr.className = 'debug-row';
        const debugTd = document.createElement('td');
        debugTd.colSpan = 5;
        debugTd.innerHTML = debugHtml;
        debugTr.appendChild(debugTd);
        resultsBody.appendChild(debugTr);
      }
    }

    // Hint banner: suggest lossy preset when images dominate and savings are low
    if (!options.lossy && r.stats?.inspect?.before) {
      const cats = r.stats.inspect.before.categories;
      const totalSize = r.stats.inspect.before.totalSize;
      const imagesCat = cats.find((c) => c.label === 'Images');
      const imagesPct = totalSize > 0 && imagesCat ? (imagesCat.totalSize / totalSize) * 100 : 0;
      const savingsPct = r.original > 0 ? (saved / r.original) * 100 : 0;

      if (imagesPct > 50 && savingsPct < 10) {
        const hintTr = document.createElement('tr');
        hintTr.className = 'hint-banner-row';
        const hintTd = document.createElement('td');
        hintTd.colSpan = 5;
        hintTd.innerHTML = `<div class="hint-banner">Images make up ${Math.round(imagesPct)}% of this file. Try the <button class="hint-banner__link" data-action="apply-web">Web preset</button> for better compression.</div>`;
        hintTr.appendChild(hintTd);
        resultsBody.appendChild(hintTr);

        hintTd.querySelector('[data-action="apply-web"]').addEventListener('click', () => {
          applyPreset('web');
          requestAnimationFrame(checkStaleResults);
        });
      }
    }
  }

  // --- Hero summary card ---
  const totalOriginal = results.reduce((s, r) => s + r.original, 0);
  const totalOptimized = results.reduce((s, r) => s + r.result.byteLength, 0);
  const totalSaved = totalOriginal - totalOptimized;
  const totalPct = totalOriginal > 0 ? ((totalSaved / totalOriginal) * 100).toFixed(1) : '0.0';
  const hasSavings = totalSaved > 0;

  const heroDiv = document.createElement('div');
  heroDiv.className = 'results-hero';

  let heroDownloadHtml = '';
  if (results.length === 1) {
    const r = results[0];
    const blob = new Blob([r.result], { type: 'application/pdf' });
    const heroUrl = URL.createObjectURL(blob);
    blobUrls.push(heroUrl);
    heroDownloadHtml = `<a href="${heroUrl}" download="${r.name}" class="btn btn--primary results-hero__download">Download</a>`;
  } else if (results.length > 1) {
    heroDownloadHtml = `<button class="btn btn--primary results-hero__download" id="hero-download-all">Download All</button>`;
  }

  const barHtml = hasSavings
    ? `<div class="results-hero__bar"><div class="results-hero__bar-fill" style="width: ${100 - parseFloat(totalPct)}%"></div></div>`
    : '';

  heroDiv.innerHTML = `
    <div class="results-hero__pct ${hasSavings ? '' : 'results-hero__pct--zero'}">${hasSavings ? `-${totalPct}%` : '0%'}</div>
    <div class="results-hero__sizes">${formatSize(totalOriginal)} \u2192 ${formatSize(totalOptimized)}</div>
    ${barHtml}
    ${heroDownloadHtml}
  `;

  const resultsTable = resultsSection.querySelector('.results-table');
  resultsSection.insertBefore(heroDiv, resultsTable);

  // Wire up hero "Download All" button
  const heroDownloadAllBtn = heroDiv.querySelector('#hero-download-all');
  if (heroDownloadAllBtn) {
    heroDownloadAllBtn.addEventListener('click', () => {
      for (const r of results) {
        const blob = new Blob([r.result], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = r.name;
        a.click();
        URL.revokeObjectURL(url);
      }
    });
  }

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
  const staleBanner = resultsSection.querySelector('.stale-banner');
  if (staleBanner) staleBanner.remove();
  const heroCard = resultsSection.querySelector('.results-hero');
  if (heroCard) heroCard.remove();
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

import { formatSize } from './helpers.js';

const CDN_BASE = 'https://khawkins98.github.io/PDF-A-go-go/';

let loadPromise = null;
const activeBlobUrls = new Set();
const activeContainers = [];
const activeObservers = new Map();

/**
 * Watch a viewer element for size changes.
 * - Dispatches window resize so PDF-A-go-go re-renders at correct size.
 * - When the viewer height changes (e.g. via grip drag), syncs the palette height.
 */
function observeResize(viewer) {
  if (activeObservers.has(viewer)) return;
  let lastHeight = viewer.offsetHeight;
  const palette = viewer.closest('.palette');
  const ro = new ResizeObserver(() => {
    window.dispatchEvent(new Event('resize'));
    // Sync grip-driven height changes to the palette
    const newHeight = viewer.offsetHeight;
    if (palette && newHeight !== lastHeight) {
      const delta = newHeight - lastHeight;
      const currentPaletteHeight = palette.offsetHeight;
      palette.style.height = `${currentPaletteHeight + delta}px`;
      lastHeight = newHeight;
    }
  });
  ro.observe(viewer);
  activeObservers.set(viewer, ro);
}

/** Lazy-load pdf-a-go-go JS + CSS from CDN. Deduplicates concurrent calls. */
function loadPdfAGoGo() {
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    // Load CSS
    if (!document.querySelector(`link[href="${CDN_BASE}pdf-a-go-go.css"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = `${CDN_BASE}pdf-a-go-go.css`;
      document.head.appendChild(link);
    }

    // Load JS
    if (window.flipbook) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = `${CDN_BASE}pdf-a-go-go.js`;
    script.onload = () => resolve();
    script.onerror = () => {
      loadPromise = null;
      reject(new Error('Failed to load pdf-a-go-go viewer'));
    };
    document.head.appendChild(script);
  });

  return loadPromise;
}

const VIEWER_CONFIG = {
  showToolbar: true,
  showSearch: false,
  showDownload: false,
  showFullscreen: false,
  showShare: false,
  showResizeGrip: true,
  showAccessibilityControlsVisibly: false,
};

/**
 * Build a preview <details> section for a result card.
 * @param {File} originalFile - The original PDF File object (kept for API compat)
 * @param {Blob} optimizedBlob - The optimized PDF as a Blob
 * @returns {HTMLDetailsElement}
 */
export function buildCompareSection(originalFile, optimizedBlob, { autoOpen = false } = {}) {
  const details = document.createElement('details');
  details.className = 'result-card__disclosure';

  const summary = document.createElement('summary');
  summary.textContent = 'Preview';
  details.appendChild(summary);

  const viewerContainer = document.createElement('div');
  viewerContainer.className = 'compare-viewer-wrap';
  details.appendChild(viewerContainer);

  let loaded = false;
  let blobUrl = null;

  details.addEventListener('toggle', async () => {
    if (!details.open) {
      // Collapse — destroy viewer and revoke URL
      destroyCompareViewers(viewerContainer);
      viewerContainer.innerHTML = '';
      if (blobUrl) { URL.revokeObjectURL(blobUrl); activeBlobUrls.delete(blobUrl); blobUrl = null; }
      loaded = false;
      return;
    }

    if (loaded) return;

    summary.textContent = 'Loading viewer\u2026';

    try {
      await loadPdfAGoGo();
    } catch (err) {
      viewerContainer.innerHTML = `<div class="compare-error">Could not load preview: ${err.message}</div>`;
      summary.textContent = 'Preview';
      return;
    }

    blobUrl = URL.createObjectURL(optimizedBlob);
    activeBlobUrls.add(blobUrl);

    viewerContainer.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'compare-side__label';
    header.innerHTML = `Optimized \u2014 ${formatSize(optimizedBlob.size)}<a href="https://github.com/khawkins98/PDF-A-go-go" target="_blank" rel="noopener" class="compare-powered-by">Powered by PDF-A-go-go</a>`;
    viewerContainer.appendChild(header);

    const viewer = document.createElement('div');
    viewer.className = 'compare-side__viewer pdfagogo-container';
    viewer.dataset.pdfUrl = blobUrl;
    viewerContainer.appendChild(viewer);

    // Initialize viewer
    try {
      const pdfagogo = window.flipbook?.default || window.flipbook;
      await pdfagogo.initializeContainer(viewer, { pdfUrl: blobUrl, ...VIEWER_CONFIG });
      activeContainers.push(viewer);
      observeResize(viewer);
    } catch (err) {
      viewerContainer.innerHTML = `<div class="compare-error">Error initializing viewer: ${err.message}</div>`;
    }

    summary.textContent = 'Preview';
    loaded = true;
  });

  if (autoOpen) details.open = true;

  return details;
}

/**
 * Build a preview container that immediately loads the viewer (no <details> wrapper).
 * Used inside the Preview palette.
 * @param {File} originalFile - The original PDF File object
 * @param {Blob} optimizedBlob - The optimized PDF as a Blob
 * @returns {HTMLElement}
 */
export function buildPreviewContent(originalFile, optimizedBlob) {
  const viewerContainer = document.createElement('div');
  viewerContainer.className = 'compare-viewer-wrap';

  // Start loading immediately
  (async () => {
    try {
      await loadPdfAGoGo();
    } catch (err) {
      viewerContainer.innerHTML = `<div class="compare-error">Could not load preview: ${err.message}</div>`;
      return;
    }

    const blobUrl = URL.createObjectURL(optimizedBlob);
    activeBlobUrls.add(blobUrl);

    const header = document.createElement('div');
    header.className = 'compare-side__label';
    header.innerHTML = `Optimized \u2014 ${formatSize(optimizedBlob.size)}<a href="https://github.com/khawkins98/PDF-A-go-go" target="_blank" rel="noopener" class="compare-powered-by">Powered by PDF-A-go-go</a>`;
    viewerContainer.appendChild(header);

    const viewer = document.createElement('div');
    viewer.className = 'compare-side__viewer pdfagogo-container';
    viewer.dataset.pdfUrl = blobUrl;
    viewerContainer.appendChild(viewer);

    try {
      const pdfagogo = window.flipbook?.default || window.flipbook;
      await pdfagogo.initializeContainer(viewer, { pdfUrl: blobUrl, ...VIEWER_CONFIG });
      activeContainers.push(viewer);
      observeResize(viewer);
    } catch (err) {
      viewerContainer.innerHTML = `<div class="compare-error">Error initializing viewer: ${err.message}</div>`;
    }
  })();

  return viewerContainer;
}

function destroyCompareViewers(container) {
  const viewers = container.querySelectorAll('.pdfagogo-container');
  viewers.forEach((el) => {
    const instance = el._pdfagogoInstance;
    if (instance && !instance.destroyed) {
      try { instance.destroy(); } catch (_) { /* already destroyed */ }
    }
    const ro = activeObservers.get(el);
    if (ro) { ro.disconnect(); activeObservers.delete(el); }
    const idx = activeContainers.indexOf(el);
    if (idx !== -1) activeContainers.splice(idx, 1);
  });
}

/** Destroy all active comparison instances and revoke all blob URLs. */
export function destroyAllComparisons() {
  for (const el of [...activeContainers]) {
    const instance = el._pdfagogoInstance;
    if (instance && !instance.destroyed) {
      try { instance.destroy(); } catch (_) { /* ignore */ }
    }
    const ro = activeObservers.get(el);
    if (ro) { ro.disconnect(); activeObservers.delete(el); }
  }
  activeContainers.length = 0;

  for (const url of activeBlobUrls) {
    URL.revokeObjectURL(url);
  }
  activeBlobUrls.clear();

  // Also collapse any open viewers in the DOM
  document.querySelectorAll('.compare-viewer-wrap').forEach((el) => {
    el.innerHTML = '';
  });
  document.querySelectorAll('details.result-card__disclosure').forEach((d) => {
    d.open = false;
  });
}

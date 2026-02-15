import { formatSize } from './helpers.js';

const CDN_BASE = 'https://khawkins98.github.io/PDF-A-go-go/';

let loadPromise = null;
const activeBlobUrls = new Set();
const activeContainers = [];
const activeObservers = new Map(); // keyed by palette element

/**
 * Watch the palette for size changes (from CSS resize grip) and destroy +
 * reinitialize the PDF-A-go-go viewer at the new dimensions.
 *
 * Why destroy/recreate instead of CSS resize:
 *   PDF-A-go-go renders into a fixed-size canvas on init. It doesn't
 *   re-render when its container changes size — an explicit pixel height +
 *   window.resize dispatch isn't enough. The only reliable way to get a
 *   correctly-sized viewer after a palette resize is to tear it down and
 *   build a fresh instance.
 *
 * Why observe the palette, not the wrap:
 *   PDF-A-go-go inserts its own internal DOM inside the wrap during init,
 *   which changes the wrap's size. Observing the wrap would false-trigger
 *   a reinit on every initial load. The palette's size only changes when
 *   the user drags the CSS resize grip.
 *
 * Why closest() instead of parentElement:
 *   PDF-A-go-go wraps the viewer element in its own internal containers
 *   during initializeContainer(). After init, viewer.parentElement points
 *   to a PDF-A-go-go wrapper, not our .compare-viewer-wrap. Using
 *   closest() traverses up to the correct ancestor.
 *
 * Why freeze palette height:
 *   The palette's CSS height is auto (content-driven) until the user
 *   manually resizes it. During reinit the old viewer is removed, which
 *   would collapse the palette to the label's height. Freezing the
 *   palette's inline height before observing prevents this. CSS
 *   resize:both overwrites inline height when the user drags, so the
 *   freeze doesn't block manual resizing.
 *
 * Why disconnect during reinit:
 *   Removing/appending DOM nodes inside the wrap changes its size, which
 *   would re-trigger the ResizeObserver and start another reinit cycle.
 *   Disconnecting before the DOM swap and reconnecting after breaks the
 *   feedback loop.
 */
function observeResize(viewer, blobUrl) {
  const wrap = viewer.closest('.compare-viewer-wrap');
  if (!wrap) return;

  // Observe the palette element, not the wrap. PDF-A-go-go renders content
  // inside the wrap which changes its size — that would false-trigger reinit
  // on every initial load. The palette's size only changes when the user
  // drags the CSS resize grip.
  const palette = wrap.closest('.palette');
  if (!palette || activeObservers.has(palette)) return;

  if (!palette.style.height) {
    palette.style.height = `${palette.offsetHeight}px`;
  }

  let debounceTimer = null;
  let currentViewer = viewer;
  let firstFire = true;

  const ro = new ResizeObserver(() => {
    // Skip the initial fire when the observer first attaches
    if (firstFire) { firstFire = false; return; }

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      ro.disconnect();

      // Destroy current viewer
      const instance = currentViewer._pdfagogoInstance;
      if (instance && !instance.destroyed) {
        try { instance.destroy(); } catch (_) { /* already gone */ }
      }
      const idx = activeContainers.indexOf(currentViewer);
      if (idx !== -1) activeContainers.splice(idx, 1);
      currentViewer.remove();

      // Create fresh viewer element
      const newViewer = document.createElement('div');
      newViewer.className = 'compare-side__viewer pdfagogo-container';
      newViewer.dataset.pdfUrl = blobUrl;
      wrap.appendChild(newViewer);

      try {
        const pdfagogo = window.flipbook?.default || window.flipbook;
        await pdfagogo.initializeContainer(newViewer, { pdfUrl: blobUrl, ...VIEWER_CONFIG });
        activeContainers.push(newViewer);
        currentViewer = newViewer;
      } catch (err) {
        console.error('[Preview] Reinit failed:', err);
      } finally {
        // Always reconnect — skip the re-attach fire
        firstFire = true;
        ro.observe(palette);
      }
    }, 400);
  });

  ro.observe(palette);
  activeObservers.set(palette, ro);
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
  showResizeGrip: false,
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
      observeResize(viewer, blobUrl);
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
      observeResize(viewer, blobUrl);
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
    const idx = activeContainers.indexOf(el);
    if (idx !== -1) activeContainers.splice(idx, 1);
  });

  // Disconnect resize observer on the parent palette (keyed by palette element)
  const palette = container.closest('.palette');
  if (palette) {
    const ro = activeObservers.get(palette);
    if (ro) { ro.disconnect(); activeObservers.delete(palette); }
  }
}

/** Destroy all active comparison instances and revoke all blob URLs. */
export function destroyAllComparisons() {
  for (const el of [...activeContainers]) {
    const instance = el._pdfagogoInstance;
    if (instance && !instance.destroyed) {
      try { instance.destroy(); } catch (_) { /* ignore */ }
    }
  }
  activeContainers.length = 0;

  for (const [, ro] of activeObservers) {
    ro.disconnect();
  }
  activeObservers.clear();

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

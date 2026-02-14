import { formatSize } from './helpers.js';

const CDN_BASE = 'https://khawkins98.github.io/PDF-A-go-go/';

let loadPromise = null;
const activeBlobUrls = new Set();
const activeContainers = [];

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
 * Build a compare <tr> for a result row.
 * @param {File} originalFile - The original PDF File object
 * @param {Blob} optimizedBlob - The optimized PDF as a Blob
 * @returns {HTMLTableRowElement}
 */
export function buildCompareRow(originalFile, optimizedBlob) {
  const tr = document.createElement('tr');
  tr.className = 'compare-row';
  const td = document.createElement('td');
  td.colSpan = 5;

  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'compare-toggle';
  toggleBtn.textContent = 'Compare';
  td.appendChild(toggleBtn);

  const viewerContainer = document.createElement('div');
  viewerContainer.className = 'compare-viewers';
  viewerContainer.hidden = true;
  td.appendChild(viewerContainer);

  tr.appendChild(td);

  let expanded = false;
  let originalUrl = null;
  let optimizedUrl = null;

  toggleBtn.addEventListener('click', async () => {
    if (expanded) {
      // Collapse — destroy viewers and revoke URLs
      destroyCompareViewers(viewerContainer);
      viewerContainer.hidden = true;
      viewerContainer.innerHTML = '';
      toggleBtn.textContent = 'Compare';
      toggleBtn.classList.remove('toggle--open');
      if (originalUrl) { URL.revokeObjectURL(originalUrl); activeBlobUrls.delete(originalUrl); originalUrl = null; }
      if (optimizedUrl) { URL.revokeObjectURL(optimizedUrl); activeBlobUrls.delete(optimizedUrl); optimizedUrl = null; }
      expanded = false;
      return;
    }

    // Expand
    toggleBtn.textContent = 'Loading viewer\u2026';
    toggleBtn.disabled = true;

    try {
      await loadPdfAGoGo();
    } catch (err) {
      viewerContainer.hidden = false;
      viewerContainer.innerHTML = `<div class="compare-error">Could not load comparison viewer: ${err.message}</div>`;
      toggleBtn.textContent = 'Compare';
      toggleBtn.disabled = false;
      return;
    }

    originalUrl = URL.createObjectURL(originalFile);
    optimizedUrl = URL.createObjectURL(optimizedBlob);
    activeBlobUrls.add(originalUrl);
    activeBlobUrls.add(optimizedUrl);

    viewerContainer.innerHTML = '';
    viewerContainer.hidden = false;

    const leftSide = buildSide('Original', formatSize(originalFile.size), originalUrl);
    const rightSide = buildSide('Optimized', formatSize(optimizedBlob.size), optimizedUrl);
    viewerContainer.appendChild(leftSide.el);
    viewerContainer.appendChild(rightSide.el);

    // Initialize viewers
    try {
      const pdfagogo = window.flipbook?.default || window.flipbook;
      await pdfagogo.initializeContainer(leftSide.viewer, { pdfUrl: originalUrl, ...VIEWER_CONFIG });
      await pdfagogo.initializeContainer(rightSide.viewer, { pdfUrl: optimizedUrl, ...VIEWER_CONFIG });

      activeContainers.push(leftSide.viewer, rightSide.viewer);

      // Scroll sync via 'seen' event with re-entrancy guard
      let syncing = false;
      const leftInstance = leftSide.viewer._pdfagogoInstance;
      const rightInstance = rightSide.viewer._pdfagogoInstance;

      if (leftInstance && rightInstance) {
        const leftViewer = leftSide.viewer.pdfViewer;
        const rightViewer = rightSide.viewer.pdfViewer;

        if (leftViewer && rightViewer) {
          leftViewer.on('seen', (pageNum) => {
            if (syncing) return;
            syncing = true;
            rightViewer.go_to_page(pageNum - 1);
            syncing = false;
          });

          rightViewer.on('seen', (pageNum) => {
            if (syncing) return;
            syncing = true;
            leftViewer.go_to_page(pageNum - 1);
            syncing = false;
          });
        }
      }
    } catch (err) {
      viewerContainer.innerHTML = `<div class="compare-error">Error initializing viewer: ${err.message}</div>`;
    }

    toggleBtn.textContent = 'Hide comparison';
    toggleBtn.classList.add('toggle--open');
    toggleBtn.disabled = false;
    expanded = true;
  });

  return tr;
}

function buildSide(label, sizeText, url) {
  const el = document.createElement('div');
  el.className = 'compare-side';

  const header = document.createElement('div');
  header.className = 'compare-side__label';
  header.textContent = `${label} \u2014 ${sizeText}`;
  el.appendChild(header);

  const viewer = document.createElement('div');
  viewer.className = 'compare-side__viewer pdfagogo-container';
  viewer.dataset.pdfUrl = url;
  el.appendChild(viewer);

  return { el, viewer };
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

  for (const url of activeBlobUrls) {
    URL.revokeObjectURL(url);
  }
  activeBlobUrls.clear();

  // Also collapse any open compare viewers in the DOM
  document.querySelectorAll('.compare-viewers').forEach((el) => {
    el.hidden = true;
    el.innerHTML = '';
  });
  document.querySelectorAll('.compare-toggle.toggle--open').forEach((btn) => {
    btn.textContent = 'Compare';
    btn.classList.remove('toggle--open');
  });
}

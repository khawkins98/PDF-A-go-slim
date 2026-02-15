import { formatSize, escapeHtml } from './helpers.js';
import { buildStatsDetail, buildDebugPanel } from './stats.js';
import { buildInspectPanel, initInspectorInteractions } from './inspector.js';
import { applyPreset } from './options.js';

/**
 * Build the hero section (savings %, sizes, bar) as DOM elements.
 * @returns {{ heroEl: HTMLElement, animateHero: () => void }}
 */
function buildHeroContent(totalOriginal, totalOptimized) {
  const totalSaved = totalOriginal - totalOptimized;
  const totalPct = totalOriginal > 0 ? ((totalSaved / totalOriginal) * 100).toFixed(1) : '0.0';
  const hasSavings = totalSaved > 0;

  const heroEl = document.createElement('div');
  heroEl.className = 'result-card__hero';

  const pctEl = document.createElement('div');
  pctEl.className = `results-hero__pct ${hasSavings ? '' : 'results-hero__pct--zero'}`;
  pctEl.textContent = hasSavings ? '-0.0%' : '0%';
  heroEl.appendChild(pctEl);

  const sizesEl = document.createElement('div');
  sizesEl.className = 'results-hero__sizes';
  sizesEl.textContent = `${formatSize(totalOriginal)} \u2192 ${formatSize(totalOptimized)}`;
  heroEl.appendChild(sizesEl);

  let barFill = null;
  if (hasSavings) {
    const barEl = document.createElement('div');
    barEl.className = 'results-hero__bar';
    barFill = document.createElement('div');
    barFill.className = 'results-hero__bar-fill';
    barFill.style.width = '0%';
    barEl.appendChild(barFill);
    heroEl.appendChild(barEl);
  }

  function animateHero(animateCountUp) {
    if (hasSavings) {
      animateCountUp(pctEl, parseFloat(totalPct));
      if (barFill) {
        requestAnimationFrame(() => {
          barFill.style.width = `${100 - parseFloat(totalPct)}%`;
        });
      }
    }
  }

  return { heroEl, animateHero };
}

/**
 * Build the hint banner if images dominate and savings are low.
 * @returns {HTMLElement|null}
 */
function buildHintBanner(result, saved, options, onStaleCheck) {
  if (options.lossy || !result.stats?.inspect?.before) return null;

  const cats = result.stats.inspect.before.categories;
  const totalSize = result.stats.inspect.before.totalSize;
  const imagesCat = cats.find((c) => c.label === 'Images');
  const imagesPct = totalSize > 0 && imagesCat ? (imagesCat.totalSize / totalSize) * 100 : 0;
  const savingsPct = result.original > 0 ? (saved / result.original) * 100 : 0;

  if (imagesPct <= 50 || savingsPct >= 10) return null;

  const banner = document.createElement('div');
  banner.className = 'hint-banner';
  banner.innerHTML = `Images make up ${Math.round(imagesPct)}% of this file. Try the <button class="hint-banner__link" data-action="apply-web">Web preset</button> for better compression.`;

  banner.querySelector('[data-action="apply-web"]').addEventListener('click', () => {
    applyPreset('web');
    requestAnimationFrame(onStaleCheck);
  });

  return banner;
}

/**
 * Build a single-file result card (hero section only — no disclosure sections).
 * Disclosure content (stats, inspector, preview) goes into separate palettes.
 * @param {Object} result - { name, originalFile, original, result, stats }
 * @param {Blob} blob - The optimized PDF blob
 * @param {string} blobUrl - Blob URL for download
 * @param {Object} options - Current optimization options
 * @param {Function} animateCountUp - Count-up animation function
 * @param {Function} onStaleCheck - Callback for stale results check
 * @returns {HTMLElement}
 */
export function buildSingleFileCard(result, blob, blobUrl, options, animateCountUp, onStaleCheck) {
  const card = document.createElement('div');
  card.className = 'result-card';

  const saved = result.original - result.result.byteLength;

  // Hero section: horizontal split (metrics left, download right)
  const { heroEl, animateHero } = buildHeroContent(result.original, result.result.byteLength);

  // Wrap metric children (pct, sizes, bar) in a container for grid layout
  const metricsEl = document.createElement('div');
  metricsEl.className = 'results-hero__metrics';
  while (heroEl.firstChild) metricsEl.appendChild(heroEl.firstChild);

  // Filename as contextual label above the percentage
  const filenameEl = document.createElement('div');
  filenameEl.className = 'result-card__filename';
  filenameEl.textContent = result.name;
  metricsEl.prepend(filenameEl);

  heroEl.appendChild(metricsEl);

  // Download button in right column
  const downloadLink = document.createElement('a');
  downloadLink.href = blobUrl;
  downloadLink.download = result.name;
  downloadLink.className = 'btn btn--primary btn--default result-card__download';
  downloadLink.textContent = 'Download';
  heroEl.appendChild(downloadLink);

  card.appendChild(heroEl);

  // Hint banner
  const hintBanner = buildHintBanner(result, saved, options, onStaleCheck);
  if (hintBanner) card.appendChild(hintBanner);

  // Trigger animation after card is in DOM
  requestAnimationFrame(() => animateHero(animateCountUp));

  return card;
}

/**
 * Build a summary card for multi-file results.
 * @param {Array} results - Array of result objects
 * @param {Function} animateCountUp - Count-up animation function
 * @returns {HTMLElement}
 */
export function buildSummaryCard(results, animateCountUp) {
  const totalOriginal = results.reduce((s, r) => s + r.original, 0);
  const totalOptimized = results.reduce((s, r) => s + r.result.byteLength, 0);

  const card = document.createElement('div');
  card.className = 'result-card result-card--summary';

  // Hero section
  const { heroEl, animateHero } = buildHeroContent(totalOriginal, totalOptimized);

  // Add "across N files" to the sizes line
  const sizesEl = heroEl.querySelector('.results-hero__sizes');
  sizesEl.textContent += ` across ${results.length} files`;

  card.appendChild(heroEl);

  // Download All button
  const downloadAllBtn = document.createElement('button');
  downloadAllBtn.className = 'btn btn--primary btn--default result-card__download';
  downloadAllBtn.textContent = 'Download All';
  downloadAllBtn.addEventListener('click', () => {
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
  card.appendChild(downloadAllBtn);

  // Trigger animation
  requestAnimationFrame(() => animateHero(animateCountUp));

  return card;
}

/**
 * Build the table header row for multi-file results.
 * @returns {HTMLElement}
 */
export function buildFileTableHeader() {
  const header = document.createElement('div');
  header.className = 'result-table__header';
  header.innerHTML = `
    <span class="result-table__col-label">Filename</span>
    <span class="result-table__col-label result-table__col-label--num">Original</span>
    <span class="result-table__col-label result-table__col-label--num">Optimized</span>
    <span class="result-table__col-label result-table__col-label--num">Saved</span>
    <span class="result-table__col-label"></span>`;
  return header;
}

/**
 * Build a table row for multi-file results.
 * @param {Object} result - { name, originalFile, original, result, stats }
 * @param {Blob} blob - The optimized PDF blob
 * @param {string} blobUrl - Blob URL for download
 * @param {Object} options - Current optimization options
 * @param {Function} onStaleCheck - Callback for stale results check
 * @returns {HTMLElement}
 */
export function buildFileCard(result, blob, blobUrl, options, onStaleCheck) {
  const row = document.createElement('div');
  row.className = 'result-table__row';

  const saved = result.original - result.result.byteLength;
  const pct = result.original > 0 ? ((saved / result.original) * 100).toFixed(1) : '0.0';

  // Data row
  const dataRow = document.createElement('div');
  dataRow.className = 'result-table__row-data';

  const nameEl = document.createElement('span');
  nameEl.className = 'result-table__cell result-table__cell--name';
  nameEl.textContent = result.name;
  nameEl.title = result.name;
  dataRow.appendChild(nameEl);

  const origEl = document.createElement('span');
  origEl.className = 'result-table__cell result-table__cell--num';
  origEl.textContent = formatSize(result.original);
  dataRow.appendChild(origEl);

  const optEl = document.createElement('span');
  optEl.className = 'result-table__cell result-table__cell--num';
  optEl.textContent = formatSize(result.result.byteLength);
  dataRow.appendChild(optEl);

  const savedEl = document.createElement('span');
  savedEl.className = `result-table__cell result-table__cell--num ${saved > 0 ? 'saved--positive' : 'saved--zero'}`;
  savedEl.textContent = saved > 0 ? `-${pct}%` : `${pct}%`;
  dataRow.appendChild(savedEl);

  const downloadLink = document.createElement('a');
  downloadLink.href = blobUrl;
  downloadLink.download = result.name;
  downloadLink.className = 'btn btn--primary btn--small result-table__cell--dl';
  downloadLink.textContent = 'Download';
  downloadLink.addEventListener('click', (e) => e.stopPropagation());
  dataRow.appendChild(downloadLink);

  row.appendChild(dataRow);

  return row;
}

/**
 * Build the full Results palette content for a single-file result.
 * Includes hero card + action buttons.
 * @returns {HTMLElement}
 */
export function buildResultsPaletteContent(results, blobUrls, options, { animateCountUp, onStaleCheck }) {
  const container = document.createElement('div');

  if (results.length === 1) {
    const r = results[0];
    const blob = new Blob([r.result], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    blobUrls.push(url);
    const card = buildSingleFileCard(r, blob, url, options, animateCountUp, onStaleCheck);
    container.appendChild(card);
  } else {
    const summaryCard = buildSummaryCard(results, animateCountUp);
    container.appendChild(summaryCard);

    const table = document.createElement('div');
    table.className = 'result-table';
    table.appendChild(buildFileTableHeader());

    for (const r of results) {
      const blob = new Blob([r.result], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      blobUrls.push(url);
      const row = buildFileCard(r, blob, url, options, onStaleCheck);
      table.appendChild(row);
    }
    container.appendChild(table);
  }

  return container;
}

/**
 * Build the Inspector palette content (stats + object breakdown).
 * @param {Object} result - Single result object with stats
 * @param {Object} options - Current optimization options
 * @returns {HTMLElement|null}
 */
function formatMetaDate(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return null; }
}

function buildMetaHeader(stats) {
  if (!stats?.documentInfo) return '';
  const info = stats.documentInfo;
  const traits = stats.pdfTraits || {};
  const esc = escapeHtml;

  const row = (label, value) =>
    `<span class="inspector-meta__label">${label}</span><span class="inspector-meta__value" title="${esc(value)}">${esc(value)}</span>`;

  const rows = [];
  rows.push(row('Pages', String(info.pageCount)));
  if (info.title) rows.push(row('Title', info.title));
  if (info.author) rows.push(row('Author', info.author));
  if (info.subject) rows.push(row('Subject', info.subject));
  if (info.keywords) rows.push(row('Keywords', info.keywords));
  if (info.creator) rows.push(row('Creator', info.creator));
  if (info.producer) rows.push(row('Producer', info.producer));
  const created = formatMetaDate(info.creationDate);
  if (created) rows.push(row('Created', created));
  const modified = formatMetaDate(info.modificationDate);
  if (modified) rows.push(row('Modified', modified));
  if (traits.pdfALevel) rows.push(row('PDF/A', traits.pdfALevel));
  rows.push(row('Tagged', traits.isTagged ? 'Yes' : 'No'));
  return `<div class="inspector-meta">${rows.join('')}</div>`;
}

export function buildInspectorPaletteContent(result, options) {
  const container = document.createElement('div');

  const metaHtml = buildMetaHeader(result.stats);
  const statsHtml = buildStatsDetail(result.stats);
  const inspectHtml = buildInspectPanel(result.stats);

  if (!statsHtml && !inspectHtml && !metaHtml) return null;

  const content = document.createElement('div');
  content.innerHTML = (metaHtml || '') + (statsHtml || '') + (inspectHtml || '');
  container.appendChild(content);

  // Wire up "Show more" interactions
  initInspectorInteractions(container);

  // Debug panel (only when ?debug URL param is present)
  if (options.debug) {
    const debugHtml = buildDebugPanel(result.stats);
    if (debugHtml) {
      const details = document.createElement('details');
      details.className = 'debug-panel';
      const summary = document.createElement('summary');
      summary.className = 'debug-panel__toggle';
      summary.textContent = 'Debug info';
      details.appendChild(summary);
      const body = document.createElement('div');
      body.className = 'debug-panel__body';
      body.innerHTML = debugHtml;
      details.appendChild(body);
      container.appendChild(details);
    }
  }

  return container;
}

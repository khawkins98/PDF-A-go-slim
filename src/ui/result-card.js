import { formatSize } from './helpers.js';
import { buildStatsDetail, buildDebugPanel } from './stats.js';
import { buildInspectPanel } from './inspector.js';
import { buildCompareSection } from './compare.js';
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
 * Build disclosure sections (details/summary) for stats, inspector, preview, debug.
 */
function buildDisclosureSections(result, blob, options, { autoOpenPreview = false } = {}) {
  const sections = [];

  // Combined stats + inspector disclosure
  const statsHtml = buildStatsDetail(result.stats);
  const inspectHtml = buildInspectPanel(result.stats);
  if (statsHtml || inspectHtml) {
    const details = document.createElement('details');
    details.className = 'result-card__disclosure';
    const summary = document.createElement('summary');
    summary.textContent = 'What was optimized';
    details.appendChild(summary);
    const content = document.createElement('div');
    content.className = 'result-card__disclosure-content';
    content.innerHTML = (statsHtml || '') + (inspectHtml || '');
    details.appendChild(content);

    // Delegated handler for "Show more..." toggles inside inspector
    content.addEventListener('click', (ev) => {
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

    sections.push(details);
  }

  // Preview disclosure
  const compareSection = buildCompareSection(result.originalFile, blob, { autoOpen: autoOpenPreview });
  sections.push(compareSection);

  // Debug disclosure (only when ?debug URL param is present)
  if (options.debug) {
    const debugHtml = buildDebugPanel(result.stats);
    if (debugHtml) {
      const details = document.createElement('details');
      details.className = 'result-card__disclosure';
      const content = document.createElement('div');
      content.className = 'result-card__disclosure-content';
      content.innerHTML = debugHtml;
      const summary = document.createElement('summary');
      summary.textContent = 'Debug info';
      details.appendChild(summary);
      details.appendChild(content);
      sections.push(details);
    }
  }

  return sections;
}

/**
 * Build a single-file result card (the 90% case).
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
  downloadLink.className = 'btn btn--primary result-card__download';
  downloadLink.textContent = 'Download';
  heroEl.appendChild(downloadLink);

  card.appendChild(heroEl);

  // Hint banner
  const hintBanner = buildHintBanner(result, saved, options, onStaleCheck);
  if (hintBanner) card.appendChild(hintBanner);

  // Disclosure sections (auto-open preview for single-file results)
  const sections = buildDisclosureSections(result, blob, options, { autoOpenPreview: true });
  for (const section of sections) card.appendChild(section);

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
  downloadAllBtn.className = 'btn btn--primary result-card__download';
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
 * Build a compact per-file card for multi-file results.
 * @param {Object} result - { name, originalFile, original, result, stats }
 * @param {Blob} blob - The optimized PDF blob
 * @param {string} blobUrl - Blob URL for download
 * @param {Object} options - Current optimization options
 * @param {Function} onStaleCheck - Callback for stale results check
 * @returns {HTMLElement}
 */
export function buildFileCard(result, blob, blobUrl, options, onStaleCheck) {
  const card = document.createElement('div');
  card.className = 'result-file-card';

  const saved = result.original - result.result.byteLength;
  const pct = result.original > 0 ? ((saved / result.original) * 100).toFixed(1) : '0.0';

  // Header: filename + sizes + percentage
  const header = document.createElement('div');
  header.className = 'result-file-card__header';

  const nameEl = document.createElement('span');
  nameEl.className = 'result-file-card__name';
  nameEl.textContent = result.name;
  header.appendChild(nameEl);

  const metaEl = document.createElement('span');
  metaEl.className = 'result-file-card__meta';
  metaEl.innerHTML = `${formatSize(result.original)} \u2192 ${formatSize(result.result.byteLength)} <span class="${saved > 0 ? 'saved--positive' : 'saved--zero'}">${saved > 0 ? `-${pct}%` : `${pct}%`}</span>`;
  header.appendChild(metaEl);

  card.appendChild(header);

  // Download button
  const downloadLink = document.createElement('a');
  downloadLink.href = blobUrl;
  downloadLink.download = result.name;
  downloadLink.className = 'btn btn--primary btn--small result-file-card__download';
  downloadLink.textContent = 'Download';
  card.appendChild(downloadLink);

  // Hint banner
  const hintBanner = buildHintBanner(result, saved, options, onStaleCheck);
  if (hintBanner) card.appendChild(hintBanner);

  // Disclosure sections
  const sections = buildDisclosureSections(result, blob, options);
  for (const section of sections) card.appendChild(section);

  return card;
}

import { formatSize, escapeHtml } from './helpers.js';

export const CATEGORY_INFO = {
  'Fonts':              { label: 'Fonts',              description: 'Embedded typefaces and font metrics',      color: 'var(--cat-fonts)' },
  'Images':             { label: 'Images',             description: 'Raster graphics embedded in the PDF',      color: 'var(--cat-images)' },
  'Page Content':       { label: 'Page Content',       description: 'Drawing instructions for each page',       color: 'var(--cat-content)' },
  'Metadata':           { label: 'Metadata',           description: 'Document info, XMP, and creator metadata', color: 'var(--cat-metadata)' },
  'Document Structure': { label: 'Document Structure', description: 'Pages, navigation, and catalog',           color: 'var(--cat-structure)' },
  'Other Data':         { label: 'Other Data',         description: 'Color profiles, encodings, and supporting data', color: 'var(--cat-other)' },
};

function formatDiff(diff) {
  if (diff === 0) return '<span class="inspect-diff--zero">\u2014</span>';
  const sign = diff < 0 ? '\u2212' : '+';
  const cls = diff < 0 ? 'inspect-diff--smaller' : 'inspect-diff--larger';
  return `<span class="${cls}">${sign}${formatSize(Math.abs(diff))}</span>`;
}

/** Build annotation describing what the optimizer did for a given category. */
function buildAnnotation(catLabel, passes) {
  if (!passes) return '';
  const parts = [];
  if (catLabel === 'Fonts') {
    for (const p of passes) {
      if (p.subsetted > 0) parts.push(`${p.subsetted} font${p.subsetted !== 1 ? 's' : ''} subsetted`);
      if (p.unembedded > 0) parts.push(`${p.unembedded} standard font${p.unembedded !== 1 ? 's' : ''} unembedded`);
    }
  } else if (catLabel === 'Images') {
    for (const p of passes) {
      if (p.converted > 0) parts.push(`${p.converted} image${p.converted !== 1 ? 's' : ''} recompressed`);
      if (p.downsampled > 0) parts.push(`${p.downsampled} image${p.downsampled !== 1 ? 's' : ''} downsampled`);
    }
  } else if (catLabel === 'Metadata') {
    for (const p of passes) {
      if (p.stripped > 0) parts.push(`${p.stripped} entr${p.stripped !== 1 ? 'ies' : 'y'} stripped`);
    }
  } else if (catLabel === 'Other Data') {
    for (const p of passes) {
      if (p.deduplicated > 0) parts.push(`${p.deduplicated} duplicate object${p.deduplicated !== 1 ? 's' : ''} merged`);
      if (p.removed > 0) parts.push(`${p.removed} unreferenced object${p.removed !== 1 ? 's' : ''} removed`);
    }
  }
  if (parts.length === 0) return '';
  return `<div class="inspect-annotation">${parts.join(', ')}</div>`;
}

/** Build a single item row (3-column: description | size | inline bar). */
function buildItemRow(item, maxItemSize, afterItem, categoryLabel) {
  const ref = escapeHtml(item.ref);
  const desc = escapeHtml(item.displayName || item.name || item.detail || '');
  const size = formatSize(item.size);
  const pct = maxItemSize > 0 ? Math.round((item.size / maxItemSize) * 100) : 0;

  let diffBadge = '';
  if (afterItem) {
    const d = afterItem.size - item.size;
    if (d !== 0) diffBadge = ` ${formatDiff(d)}`;
  } else if (categoryLabel === 'Page Content') {
    diffBadge = ' <span class="inspect-diff--removed" title="Content stream data no longer present as a separate object \u2014 likely merged with an identical stream">stream merged</span>';
  } else {
    diffBadge = ' <span class="inspect-diff--removed">removed</span>';
  }

  return `<div class="inspect-item" title="${ref}">
    <span class="inspect-item__desc">${desc}</span>
    <span class="inspect-item__size">${size}${diffBadge}</span>
    <span class="inspect-item__bar"><span class="inspect-item__bar-fill" style="--item-pct: ${pct}%"></span></span>
  </div>`;
}

/** Wrap a list of item rows with a "Show N more..." toggle if needed. */
function collapseItems(rows, limit) {
  if (rows.length <= limit) return rows.join('');
  const visible = rows.slice(0, Math.min(5, limit));
  const hidden = rows.slice(Math.min(5, limit));
  return visible.join('') +
    `<div class="inspect-collapse" hidden>${hidden.join('')}</div>` +
    `<button class="inspect-show-more" data-count="${hidden.length}">Show ${hidden.length} more\u2026</button>`;
}

/** Build a sub-group header + items for the "Other Data" category. */
function buildSubGroups(items, maxItemSize, afterItemMap, categoryLabel) {
  const groups = new Map();
  for (const item of items) {
    const key = item.subCategory || 'Miscellaneous';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  const html = [];
  for (const [groupName, groupItems] of groups) {
    const groupSize = groupItems.reduce((s, i) => s + i.size, 0);
    const header = `<div class="inspect-subgroup__header">${escapeHtml(groupName)} \u2014 ${groupItems.length} item${groupItems.length !== 1 ? 's' : ''}, ${formatSize(groupSize)}</div>`;

    if (groupName === 'Miscellaneous') {
      html.push(header);
    } else {
      const rows = groupItems
        .filter((i) => i.size > 0)
        .map((item) => buildItemRow(item, maxItemSize, afterItemMap?.get(item.ref), categoryLabel));
      html.push(header + collapseItems(rows, 10));
    }
  }
  return html.join('');
}

function buildCategoryRow(catBefore, catAfter, totalBeforeSize, passes) {
  const info = CATEGORY_INFO[catBefore.label] || { label: catBefore.label, description: '', color: 'var(--cat-other)' };
  const bSize = catBefore.totalSize;
  const aSize = catAfter.totalSize;
  const diff = aSize - bSize;
  const pct = totalBeforeSize > 0 ? Math.round((bSize / totalBeforeSize) * 100) : 0;

  const visibleItems = catBefore.items.filter((i) => i.size > 0);
  const maxItemSize = visibleItems.reduce((m, i) => Math.max(m, i.size), 0);

  const afterItemMap = new Map();
  for (const item of catAfter.items) {
    afterItemMap.set(item.ref, item);
  }

  let itemsHtml;
  if (catBefore.label === 'Other Data' && visibleItems.length > 0) {
    itemsHtml = buildSubGroups(visibleItems, maxItemSize, afterItemMap, catBefore.label);
  } else if (visibleItems.length > 0) {
    const rows = visibleItems.map((item) =>
      buildItemRow(item, maxItemSize, afterItemMap.get(item.ref), catBefore.label)
    );
    itemsHtml = collapseItems(rows, 10);
  } else {
    itemsHtml = '<div class="inspect-item inspect-item--summary">No objects</div>';
  }

  const annotation = buildAnnotation(catBefore.label, passes);

  return `<details class="inspect-category" open style="--cat-accent: ${info.color}; --pct: ${pct}%">
    <summary class="inspect-category__header">
      <span class="inspect-category__label">${info.label}<span class="inspect-category__desc-text">${info.description}</span></span>
      <span class="inspect-category__before">${formatSize(bSize)} <small>(${catBefore.count})</small></span>
      <span class="inspect-category__after">${formatSize(aSize)} <small>(${catAfter.count})</small></span>
      <span class="inspect-category__saved">${formatDiff(diff)}</span>
    </summary>
    <div class="inspect-category__items">
      ${annotation}
      ${itemsHtml}
    </div>
  </details>`;
}

/**
 * Set up delegated click handler for "Show more..." toggles inside a container.
 * @param {HTMLElement} containerEl
 */
export function initInspectorInteractions(containerEl) {
  containerEl.addEventListener('click', (ev) => {
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

/**
 * Generate a self-contained HTML report for the Inspector analysis.
 * @param {Object} stats - The optimization stats object
 * @param {string} filename - The original PDF filename
 * @returns {string} Complete HTML document string
 */
export function generateHtmlReport(stats, filename) {
  if (!stats?.inspect?.before || !stats?.inspect?.after) return null;
  const { before, after } = stats.inspect;
  const passes = stats.passes || [];
  const info = stats.documentInfo || {};
  const traits = stats.pdfTraits || {};

  const totalDiff = after.totalSize - before.totalSize;
  const savedPct = before.totalSize > 0
    ? (((before.totalSize - after.totalSize) / before.totalSize) * 100).toFixed(1)
    : '0.0';

  function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  // Document info rows
  const infoRows = [];
  if (info.pageCount) infoRows.push(`<tr><td>Pages</td><td>${info.pageCount}</td></tr>`);
  if (info.title) infoRows.push(`<tr><td>Title</td><td>${esc(info.title)}</td></tr>`);
  if (info.author) infoRows.push(`<tr><td>Author</td><td>${esc(info.author)}</td></tr>`);
  if (info.creator) infoRows.push(`<tr><td>Creator</td><td>${esc(info.creator)}</td></tr>`);
  if (info.producer) infoRows.push(`<tr><td>Producer</td><td>${esc(info.producer)}</td></tr>`);
  if (traits.pdfALevel) infoRows.push(`<tr><td>PDF/A</td><td>${esc(traits.pdfALevel)}</td></tr>`);
  infoRows.push(`<tr><td>Tagged</td><td>${traits.isTagged ? 'Yes' : 'No'}</td></tr>`);

  // Category breakdown
  const categoryRows = before.categories.map((catB, i) => {
    const catA = after.categories[i];
    const ci = CATEGORY_INFO[catB.label] || { label: catB.label };
    const diff = catA.totalSize - catB.totalSize;
    const diffStr = diff === 0 ? '\u2014' : (diff < 0 ? `\u2212${formatSize(Math.abs(diff))}` : `+${formatSize(diff)}`);

    // Item details
    const afterMap = new Map();
    for (const item of catA.items) afterMap.set(item.ref, item);

    const itemRows = catB.items.filter(it => it.size > 0).map(item => {
      const afterItem = afterMap.get(item.ref);
      let status;
      if (afterItem) {
        const d = afterItem.size - item.size;
        status = d === 0 ? '\u2014' : (d < 0 ? `\u2212${formatSize(Math.abs(d))}` : `+${formatSize(d)}`);
      } else {
        status = catB.label === 'Page Content' ? 'stream merged' : 'removed';
      }
      return `<tr><td style="padding-left:2rem">${esc(item.displayName || item.name || item.detail || item.ref)}</td><td>${formatSize(item.size)}</td><td>${status}</td></tr>`;
    }).join('');

    return `<tr style="font-weight:600"><td>${esc(ci.label)}</td><td>${formatSize(catB.totalSize)} (${catB.count})</td><td>${formatSize(catA.totalSize)} (${catA.count})</td><td>${diffStr}</td></tr>${itemRows}`;
  }).join('');

  // Pass stats
  const passRows = passes.map(p => {
    const parts = [];
    if (p.recompressed > 0) parts.push(`${p.recompressed} stream${p.recompressed !== 1 ? 's' : ''} recompressed`);
    if (p.converted > 0) parts.push(`${p.converted} image${p.converted !== 1 ? 's' : ''} recompressed`);
    if (p.downsampled > 0) parts.push(`${p.downsampled} image${p.downsampled !== 1 ? 's' : ''} downsampled`);
    if (p.unembedded > 0) parts.push(`${p.unembedded} font${p.unembedded !== 1 ? 's' : ''} unembedded`);
    if (p.subsetted > 0) parts.push(`${p.subsetted} font${p.subsetted !== 1 ? 's' : ''} subsetted`);
    if (p.deduplicated > 0) parts.push(`${p.deduplicated} duplicate${p.deduplicated !== 1 ? 's' : ''} merged`);
    if (p.stripped > 0) parts.push(`${p.stripped} metadata entr${p.stripped !== 1 ? 'ies' : 'y'} stripped`);
    if (p.removed > 0) parts.push(`${p.removed} unreferenced object${p.removed !== 1 ? 's' : ''} removed`);
    if (parts.length === 0) return '';
    return `<tr><td>${esc(p.name)}</td><td>${parts.join(', ')}</td></tr>`;
  }).filter(Boolean).join('');

  // Accessibility traits
  const a11yRows = [];
  if (traits.isTagged != null) a11yRows.push(`<tr><td>Tagged PDF</td><td>${traits.isTagged ? 'Yes' : 'No'}</td></tr>`);
  if (traits.pdfALevel) a11yRows.push(`<tr><td>PDF/A</td><td>${esc(traits.pdfALevel)}</td></tr>`);
  if (traits.pdfUALevel) a11yRows.push(`<tr><td>PDF/UA</td><td>${esc(traits.pdfUALevel)}</td></tr>`);
  if (info.title) a11yRows.push(`<tr><td>Document title</td><td>${esc(info.title)}</td></tr>`);

  const date = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Inspector Report \u2014 ${esc(filename)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; line-height: 1.5; }
  h1 { font-size: 1.4rem; border-bottom: 2px solid #333; padding-bottom: 0.4rem; margin-bottom: 0.5rem; }
  h2 { font-size: 1.1rem; margin-top: 1.5rem; margin-bottom: 0.5rem; color: #333; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 1rem; font-size: 0.85rem; }
  th, td { text-align: left; padding: 0.3rem 0.6rem; border-bottom: 1px solid #ddd; }
  th { background: #f5f5f5; font-weight: 600; }
  .summary { background: #f0f4ff; border: 1px solid #c0d0f0; border-radius: 4px; padding: 0.8rem 1rem; margin-bottom: 1rem; }
  .summary strong { font-size: 1.2rem; }
  .footer { margin-top: 2rem; padding-top: 0.5rem; border-top: 1px solid #ddd; font-size: 0.75rem; color: #888; }
</style>
</head>
<body>
<h1>Inspector Report</h1>
<p><strong>${esc(filename)}</strong> &mdash; ${esc(date)}</p>

<div class="summary">
  <strong>${savedPct}% reduction</strong> &mdash;
  ${formatSize(before.totalSize)} &rarr; ${formatSize(after.totalSize)}
  (${before.objectCount} obj &rarr; ${after.objectCount} obj)
</div>

${infoRows.length > 0 ? `<h2>Document Info</h2><table>${infoRows.join('')}</table>` : ''}

<h2>Category Breakdown</h2>
<table>
  <thead><tr><th>Category</th><th>Before</th><th>After</th><th>Saved</th></tr></thead>
  <tbody>
    ${categoryRows}
    <tr style="font-weight:700;border-top:2px solid #333"><td>Total</td><td>${formatSize(before.totalSize)} (${before.objectCount} obj)</td><td>${formatSize(after.totalSize)} (${after.objectCount} obj)</td><td>${totalDiff === 0 ? '\u2014' : (totalDiff < 0 ? `\u2212${formatSize(Math.abs(totalDiff))}` : `+${formatSize(totalDiff)}`)}</td></tr>
  </tbody>
</table>

${passRows ? `<h2>Optimization Passes</h2><table><thead><tr><th>Pass</th><th>Result</th></tr></thead><tbody>${passRows}</tbody></table>` : ''}

${a11yRows.length > 0 ? `<h2>Accessibility Traits</h2><table>${a11yRows.join('')}</table>` : ''}

<div class="footer">Generated by PDF-A-go-slim</div>
</body>
</html>`;
}

export function buildInspectPanel(stats) {
  if (!stats?.inspect?.before || !stats?.inspect?.after) return null;
  const { before, after } = stats.inspect;
  const passes = stats.passes || [];

  const rows = before.categories.map((catB, i) =>
    buildCategoryRow(catB, after.categories[i], before.totalSize, passes)
  ).join('');

  const totalDiff = after.totalSize - before.totalSize;

  return `<div class="inspect-panel">
    <div class="inspect-panel__header">
      <span></span>
      <span class="inspect-panel__col-label">Before</span>
      <span class="inspect-panel__col-label">After</span>
      <span class="inspect-panel__col-label">Saved</span>
    </div>
    ${rows}
    <div class="inspect-panel__total">
      <span class="inspect-category__label">Total</span>
      <span>${formatSize(before.totalSize)} <small>(${before.objectCount} obj)</small></span>
      <span>${formatSize(after.totalSize)} <small>(${after.objectCount} obj)</small></span>
      <span>${formatDiff(totalDiff)}</span>
    </div>
  </div>`;
}

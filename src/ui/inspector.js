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
function buildItemRow(item, maxItemSize, afterItem) {
  const ref = escapeHtml(item.ref);
  const desc = escapeHtml(item.displayName || item.name || item.detail || '');
  const size = formatSize(item.size);
  const pct = maxItemSize > 0 ? Math.round((item.size / maxItemSize) * 100) : 0;

  let diffBadge = '';
  if (afterItem) {
    const d = afterItem.size - item.size;
    if (d !== 0) diffBadge = ` ${formatDiff(d)}`;
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
function buildSubGroups(items, maxItemSize, afterItemMap) {
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
        .map((item) => buildItemRow(item, maxItemSize, afterItemMap?.get(item.ref)));
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
    itemsHtml = buildSubGroups(visibleItems, maxItemSize, afterItemMap);
  } else if (visibleItems.length > 0) {
    const rows = visibleItems.map((item) =>
      buildItemRow(item, maxItemSize, afterItemMap.get(item.ref))
    );
    itemsHtml = collapseItems(rows, 10);
  } else {
    itemsHtml = '<div class="inspect-item inspect-item--summary">No objects</div>';
  }

  const annotation = buildAnnotation(catBefore.label, passes);

  return `<details class="inspect-category" style="--cat-accent: ${info.color}; --pct: ${pct}%">
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

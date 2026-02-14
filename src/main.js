import './style.css';

// --- State ---
let blobUrls = [];
let lastFiles = null;

// --- DOM refs ---
const dropZone = document.getElementById('drop-zone');
const dropArea = dropZone.querySelector('.drop-area');
const fileInput = document.getElementById('file-input');
const processingSection = document.getElementById('processing');
const fileList = document.getElementById('file-list');
const resultsSection = document.getElementById('results');
const resultsBody = document.getElementById('results-body');
const btnDownloadAll = document.getElementById('btn-download-all');
const btnReoptimize = document.getElementById('btn-reoptimize');
const btnStartOver = document.getElementById('btn-start-over');
const optionsPanel = document.getElementById('options-panel');

// Options panel refs
const presetBtns = document.querySelectorAll('.preset-btn');
const modeBtns = document.querySelectorAll('.mode-btn');
const qualityRow = document.querySelector('.control-row--quality');
const qualitySlider = document.getElementById('quality-slider');
const qualityValue = document.getElementById('quality-value');
const dpiRow = document.querySelector('.control-row--dpi');
const dpiInput = document.getElementById('max-dpi');
const unembedCheckbox = document.getElementById('unembed-fonts');
const subsetCheckbox = document.getElementById('subset-fonts');

// --- Presets ---
const PRESETS = {
  lossless: { lossy: false, imageQuality: 0.85, unembedStandardFonts: true, subsetFonts: true },
  web:      { lossy: true,  imageQuality: 0.75, unembedStandardFonts: true, subsetFonts: true, maxImageDpi: 150 },
  print:    { lossy: true,  imageQuality: 0.92, unembedStandardFonts: true, subsetFonts: true, maxImageDpi: 300 },
};

function applyPreset(name) {
  const p = PRESETS[name];
  if (!p) return;

  // Update preset buttons
  presetBtns.forEach((btn) => {
    btn.classList.toggle('preset-btn--active', btn.dataset.preset === name);
  });

  // Update mode toggle
  modeBtns.forEach((btn) => {
    btn.classList.toggle('mode-btn--active', btn.dataset.mode === (p.lossy ? 'lossy' : 'lossless'));
  });

  // Quality slider
  qualityRow.hidden = !p.lossy;
  qualitySlider.value = Math.round(p.imageQuality * 100);
  qualityValue.textContent = Math.round(p.imageQuality * 100);

  // DPI input
  dpiRow.hidden = !p.lossy;
  dpiInput.value = p.maxImageDpi || '';

  // Unembed checkbox
  unembedCheckbox.checked = p.unembedStandardFonts;

  // Subset checkbox
  subsetCheckbox.checked = p.subsetFonts;
}

function syncPresetIndicator() {
  const current = collectOptions();
  for (const [name, p] of Object.entries(PRESETS)) {
    if (current.lossy === p.lossy &&
        current.unembedStandardFonts === p.unembedStandardFonts &&
        current.subsetFonts === p.subsetFonts &&
        (!current.lossy || (current.imageQuality === p.imageQuality &&
                            current.maxImageDpi === p.maxImageDpi))) {
      presetBtns.forEach((btn) => {
        btn.classList.toggle('preset-btn--active', btn.dataset.preset === name);
      });
      return;
    }
  }
  // No preset matches — clear all
  presetBtns.forEach((btn) => btn.classList.remove('preset-btn--active'));
}

function collectOptions() {
  const lossy = document.querySelector('.mode-btn--active')?.dataset.mode === 'lossy';
  const dpiVal = parseInt(dpiInput.value, 10);
  return {
    lossy,
    imageQuality: lossy ? parseInt(qualitySlider.value, 10) / 100 : undefined,
    maxImageDpi: lossy && dpiVal > 0 ? dpiVal : undefined,
    unembedStandardFonts: unembedCheckbox.checked,
    subsetFonts: subsetCheckbox.checked,
  };
}

// --- Options panel event listeners ---
presetBtns.forEach((btn) => {
  btn.addEventListener('click', () => applyPreset(btn.dataset.preset));
});

modeBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    modeBtns.forEach((b) => b.classList.remove('mode-btn--active'));
    btn.classList.add('mode-btn--active');
    const isLossy = btn.dataset.mode === 'lossy';
    qualityRow.hidden = !isLossy;
    dpiRow.hidden = !isLossy;
    syncPresetIndicator();
  });
});

qualitySlider.addEventListener('input', () => {
  qualityValue.textContent = qualitySlider.value;
  syncPresetIndicator();
});

dpiInput.addEventListener('input', syncPresetIndicator);

unembedCheckbox.addEventListener('change', syncPresetIndicator);

subsetCheckbox.addEventListener('change', syncPresetIndicator);

// --- Helpers ---
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function showState(state) {
  dropZone.hidden = state !== 'idle';
  processingSection.hidden = state !== 'processing';
  resultsSection.hidden = state !== 'results';
  optionsPanel.hidden = state === 'processing';
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

// --- Pass stats formatting ---
function formatPassStats(passStats) {
  if (!passStats) return '';
  const { name, error, ...rest } = passStats;
  if (error) return `${name}: error`;

  const parts = [];
  if (rest.recompressed != null && rest.recompressed > 0)
    parts.push(`${rest.recompressed} stream${rest.recompressed !== 1 ? 's' : ''} recompressed`);
  if (rest.converted != null && rest.converted > 0)
    parts.push(`${rest.converted} image${rest.converted !== 1 ? 's' : ''} converted to JPEG`);
  if (rest.downsampled != null && rest.downsampled > 0)
    parts.push(`${rest.downsampled} image${rest.downsampled !== 1 ? 's' : ''} downsampled`);
  if (rest.unembedded != null && rest.unembedded > 0)
    parts.push(`${rest.unembedded} font${rest.unembedded !== 1 ? 's' : ''} unembedded`);
  if (rest.subsetted != null && rest.subsetted > 0)
    parts.push(`${rest.subsetted} font${rest.subsetted !== 1 ? 's' : ''} subsetted`);
  if (rest.deduplicated != null && rest.deduplicated > 0)
    parts.push(`${rest.deduplicated} duplicate${rest.deduplicated !== 1 ? 's' : ''} removed`);
  if (rest.stripped != null && rest.stripped > 0)
    parts.push(`${rest.stripped} metadata entr${rest.stripped !== 1 ? 'ies' : 'y'} stripped`);
  if (rest.removed != null && rest.removed > 0)
    parts.push(`${rest.removed} unreferenced object${rest.removed !== 1 ? 's' : ''} removed`);

  return parts.length > 0 ? parts.join(', ') : null;
}

function buildStatsDetail(stats) {
  if (!stats?.passes) return null;
  const items = stats.passes
    .map((p) => {
      const text = formatPassStats(p);
      return text ? `<li class="pass-stats__item pass-stats__item--active">${text}</li>` : null;
    })
    .filter(Boolean);

  if (items.length === 0) return null;
  if (stats.sizeGuard) {
    items.push('<li class="pass-stats__item">Size guard: kept original (optimized was larger)</li>');
  }
  return `<ul class="pass-stats__list">${items.join('')}</ul>`;
}

// --- Object inspector ---
const CATEGORY_INFO = {
  'Fonts':              { label: 'Fonts',              description: 'Embedded typefaces and font metrics',      color: 'var(--cat-fonts)' },
  'Images':             { label: 'Images',             description: 'Raster graphics embedded in the PDF',      color: 'var(--cat-images)' },
  'Page Content':       { label: 'Page Content',       description: 'Drawing instructions for each page',       color: 'var(--cat-content)' },
  'Metadata':           { label: 'Metadata',           description: 'Document info, XMP, and creator metadata', color: 'var(--cat-metadata)' },
  'Document Structure': { label: 'Document Structure', description: 'Pages, navigation, and catalog',           color: 'var(--cat-structure)' },
  'Other Data':         { label: 'Other Data',         description: 'Color profiles, encodings, and supporting data', color: 'var(--cat-other)' },
};

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDiff(diff) {
  if (diff === 0) return '';
  const sign = diff < 0 ? '\u2212' : '+'; // minus sign or plus
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
    // Item was removed after optimization
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
  const groups = new Map(); // subCategory → items[]
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
      // Summary only — no individual items
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

  // Build after-item lookup by ref for per-item diffs
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
      <span class="inspect-category__label">${info.label}</span>
      <span class="inspect-category__desc-text">${info.description}</span>
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

function buildInspectPanel(stats) {
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
      <span></span>
      <span class="inspect-panel__col-label">Before</span>
      <span class="inspect-panel__col-label">After</span>
      <span class="inspect-panel__col-label">Saved</span>
    </div>
    ${rows}
    <div class="inspect-panel__total">
      <span class="inspect-category__label">Total</span>
      <span></span>
      <span>${formatSize(before.totalSize)} <small>(${before.objectCount} obj)</small></span>
      <span>${formatSize(after.totalSize)} <small>(${after.objectCount} obj)</small></span>
      <span>${formatDiff(totalDiff)}</span>
    </div>
  </div>`;
}

// --- Main flow ---
async function handleFiles(files) {
  const pdfFiles = Array.from(files).filter(
    (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'),
  );
  if (pdfFiles.length === 0) return;

  lastFiles = pdfFiles;

  const options = collectOptions();

  showState('processing');
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

      results.push({ name: file.name, original: file.size, result, stats });
    } catch (err) {
      passEl.textContent = `Error: ${err.message}`;
      fillEl.style.width = '100%';
      fillEl.classList.add('file-item__fill--error');
    }
  }

  // Show results
  showState('results');
  resultsBody.innerHTML = '';
  revokeBlobUrls();

  for (const r of results) {
    const blob = new Blob([r.result], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    blobUrls.push(url);

    const saved = r.original - r.result.byteLength;
    const pct = r.original > 0 ? ((saved / r.original) * 100).toFixed(1) : '0.0';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.name}</td>
      <td>${formatSize(r.original)}</td>
      <td>${formatSize(r.result.byteLength)}</td>
      <td class="${saved > 0 ? 'saved--positive' : 'saved--zero'}">${saved > 0 ? '-' : ''}${pct}%</td>
      <td><a href="${url}" download="${r.name}" class="btn btn--small">Download</a></td>
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
  }

  btnDownloadAll.hidden = results.length <= 1;
  btnDownloadAll.onclick = () => {
    for (const r of results) {
      const blob = new Blob([r.result], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = r.name;
      a.click();
      URL.revokeObjectURL(url);
    }
  };
}

// --- Event listeners ---
dropArea.addEventListener('click', () => fileInput.click());
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
  lastFiles = null;
  fileInput.value = '';
  showState('idle');
});

showState('idle');

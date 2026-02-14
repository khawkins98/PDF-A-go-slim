import { formatSize, escapeHtml } from './helpers.js';

export function formatPassStats(passStats) {
  if (!passStats) return '';
  const { name, error, ...rest } = passStats;
  if (error) return `${name}: error`;

  const parts = [];
  if (rest.recompressed != null && rest.recompressed > 0)
    parts.push(`${rest.recompressed} stream${rest.recompressed !== 1 ? 's' : ''} recompressed`);
  if (rest.converted != null && rest.converted > 0)
    parts.push(`${rest.converted} image${rest.converted !== 1 ? 's' : ''} recompressed`);
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

export function buildStatsDetail(stats) {
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

export function buildDebugPanel(stats) {
  if (!stats?.passes) return null;

  const timingRows = stats.passes.map((p) => {
    const ms = p._ms != null ? `${p._ms} ms` : '\u2014';
    const err = p.error ? ` <span style="color:var(--color-error)">(error)</span>` : '';
    return `<tr><td>${escapeHtml(p.name)}</td><td style="text-align:right">${ms}${err}</td></tr>`;
  }).join('');

  const totalMs = stats.passes.reduce((s, p) => s + (p._ms || 0), 0);

  let html = `<table class="debug-table">
    <thead><tr><th>Pass</th><th style="text-align:right">Time</th></tr></thead>
    <tbody>${timingRows}
      <tr style="font-weight:600"><td>Total</td><td style="text-align:right">${totalMs} ms</td></tr>
    </tbody>
  </table>`;

  const imagesPass = stats.passes.find((p) => p._debug);
  if (imagesPass) {
    const { skipReasons, _debug } = imagesPass;

    if (skipReasons && Object.values(skipReasons).some((v) => v > 0)) {
      const reasonRows = Object.entries(skipReasons)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td style="text-align:right">${v}</td></tr>`)
        .join('');
      html += `<h4 style="margin-top:0.75rem">Image skip reasons</h4>
        <table class="debug-table">
          <thead><tr><th>Reason</th><th style="text-align:right">Count</th></tr></thead>
          <tbody>${reasonRows}</tbody>
        </table>`;
    }

    const converted = _debug.filter((e) => e.action === 'convert');
    if (converted.length > 0) {
      const convRows = converted.map((e) => {
        const saved = e.beforeSize - e.afterSize;
        const pct = e.beforeSize > 0 ? ((saved / e.beforeSize) * 100).toFixed(1) : '0';
        const ds = e.didDownsample ? ' (downsampled)' : '';
        return `<tr>
          <td title="${escapeHtml(e.ref)}">${escapeHtml(e.ref)}</td>
          <td style="text-align:right">${formatSize(e.beforeSize)}</td>
          <td style="text-align:right">${formatSize(e.afterSize)}</td>
          <td style="text-align:right">-${pct}%${ds}</td>
        </tr>`;
      }).join('');
      html += `<h4 style="margin-top:0.75rem">Converted images</h4>
        <table class="debug-table">
          <thead><tr><th>Ref</th><th style="text-align:right">Before</th><th style="text-align:right">After</th><th style="text-align:right">Saved</th></tr></thead>
          <tbody>${convRows}</tbody>
        </table>`;
    }

    const skips = _debug.filter((e) => e.action === 'skip');
    if (skips.length > 0) {
      const skipRows = skips.map((e) => {
        const detail = e.message || e.value || (e.filters ? e.filters.join(',') : '') || '';
        return `<tr>
          <td title="${escapeHtml(e.ref)}">${escapeHtml(e.ref)}</td>
          <td>${escapeHtml(e.reason)}</td>
          <td>${escapeHtml(detail)}</td>
        </tr>`;
      }).join('');
      html += `<h4 style="margin-top:0.75rem">Skipped images</h4>
        <table class="debug-table">
          <thead><tr><th>Ref</th><th>Reason</th><th>Detail</th></tr></thead>
          <tbody>${skipRows}</tbody>
        </table>`;
    }
  }

  return html;
}

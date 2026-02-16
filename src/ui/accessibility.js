/**
 * Accessibility palette UI — trait checklist, lightweight audits, external validator links.
 */
import { escapeHtml } from './helpers.js';

const VALIDATORS = [
  { name: 'veraPDF', desc: 'PDF/A conformance', url: 'https://verapdf.org' },
  { name: 'PAC', desc: 'PDF/UA accessibility', url: 'https://pdfua.foundation/en/pac-download' },
  { name: 'PAVE', desc: 'Online checker', url: 'https://pave-pdf.org' },
];

function buildValidatorLinks() {
  const items = VALIDATORS.map(
    v => `<li><a href="${v.url}" target="_blank" rel="noopener">${escapeHtml(v.name)}</a> &mdash; ${escapeHtml(v.desc)}</li>`
  ).join('');
  return `<div class="a11y-validators">
    <div class="a11y-validators__title">Validate with external tools</div>
    <ul class="a11y-validators__list">${items}</ul>
  </div>`;
}

function checkIcon(pass) {
  const cls = pass ? 'a11y-check__icon--pass' : 'a11y-check__icon--fail';
  const symbol = pass ? '\u2713' : '\u2717';
  return `<span class="a11y-check__icon ${cls}">${symbol}</span>`;
}

function buildTraitChecklist(pdfTraits) {
  const rows = [
    { label: 'Tagged PDF', pass: pdfTraits.isTagged, value: pdfTraits.isTagged ? 'Yes' : 'No' },
    { label: 'Structure Tree', pass: pdfTraits.hasStructTree, value: pdfTraits.hasStructTree ? 'Present' : 'Missing' },
    { label: 'Document Language', pass: !!pdfTraits.lang, value: pdfTraits.lang || 'Not set' },
    { label: 'PDF/A', pass: pdfTraits.isPdfA, value: pdfTraits.isPdfA ? pdfTraits.pdfALevel : 'No' },
    { label: 'PDF/UA', pass: pdfTraits.isPdfUA, value: pdfTraits.isPdfUA ? 'Yes' : 'No' },
  ];

  const gridRows = rows.map(r =>
    `${checkIcon(r.pass)}<span class="a11y-checklist__label">${escapeHtml(r.label)}</span><span class="a11y-checklist__value">${escapeHtml(r.value)}</span>`
  ).join('');

  return `<div class="a11y-checklist">${gridRows}</div>`;
}

function buildAuditResults(audit) {
  const sections = [];

  // ToUnicode coverage
  const tu = audit.toUnicode;
  if (tu.total > 0) {
    const allGood = tu.total === tu.withToUnicode;
    const summary = `${tu.withToUnicode} of ${tu.total} font${tu.total !== 1 ? 's' : ''} have ToUnicode CMap`;
    const summaryClass = allGood ? 'a11y-audit__summary--good' : '';
    const missing = tu.fonts.filter(f => !f.hasToUnicode);
    let detail = '';
    if (missing.length > 0) {
      const items = missing.map(f => `<li>${escapeHtml(f.name)}</li>`).join('');
      detail = `<ul class="a11y-audit__font-list">${items}</ul>`;
    }
    sections.push(`<details class="a11y-audit">
      <summary class="a11y-audit__header"><span class="a11y-audit__title">Text Extractability</span><span class="a11y-audit__summary ${summaryClass}">${summary}</span></summary>
      <div class="a11y-audit__body">${detail || '<p class="a11y-audit__note">All fonts have Unicode mappings.</p>'}</div>
    </details>`);
  } else {
    sections.push(`<details class="a11y-audit">
      <summary class="a11y-audit__header"><span class="a11y-audit__title">Text Extractability</span><span class="a11y-audit__summary">No fonts found</span></summary>
      <div class="a11y-audit__body"><p class="a11y-audit__note">No embedded fonts detected.</p></div>
    </details>`);
  }

  // Image alt text
  const ia = audit.imageAlt;
  if (ia.figures) {
    const allGood = ia.figures.total > 0 && ia.figures.withoutAlt === 0;
    const summary = ia.figures.total > 0
      ? `${ia.figures.withAlt} of ${ia.figures.total} figure${ia.figures.total !== 1 ? 's' : ''} have alt text`
      : `No figure elements (${ia.totalImages} image${ia.totalImages !== 1 ? 's' : ''})`;
    const summaryClass = allGood ? 'a11y-audit__summary--good' : '';
    sections.push(`<details class="a11y-audit">
      <summary class="a11y-audit__header"><span class="a11y-audit__title">Image Descriptions</span><span class="a11y-audit__summary ${summaryClass}">${summary}</span></summary>
      <div class="a11y-audit__body"><p class="a11y-audit__note">${ia.totalImages} image XObject${ia.totalImages !== 1 ? 's' : ''} in document.</p></div>
    </details>`);
  } else {
    sections.push(`<details class="a11y-audit">
      <summary class="a11y-audit__header"><span class="a11y-audit__title">Image Descriptions</span><span class="a11y-audit__summary">N/A</span></summary>
      <div class="a11y-audit__body"><p class="a11y-audit__note">Requires tagged PDF with structure tree.</p></div>
    </details>`);
  }

  // Structure tree
  const st = audit.structureTree;
  if (st) {
    const summary = `${st.elementCount} element${st.elementCount !== 1 ? 's' : ''} across ${st.elementTypes.length} type${st.elementTypes.length !== 1 ? 's' : ''}, max depth ${st.maxDepth}`;
    const types = st.elementTypes.map(t => escapeHtml(t)).join(', ');
    sections.push(`<details class="a11y-audit">
      <summary class="a11y-audit__header"><span class="a11y-audit__title">Structure Tree</span><span class="a11y-audit__summary">${summary}</span></summary>
      <div class="a11y-audit__body"><p class="a11y-audit__note">Element types: ${types}</p></div>
    </details>`);
  }

  return sections.join('');
}

/**
 * Build accessibility palette content after optimization.
 * @param {object} stats - Result stats from the pipeline
 * @returns {HTMLElement}
 */
export function buildAccessibilityPaletteContent(stats) {
  const container = document.createElement('div');
  container.className = 'a11y-panel';

  let html = '';

  // Section A: Trait checklist
  if (stats.pdfTraits) {
    html += buildTraitChecklist(stats.pdfTraits);
  }

  // Section B: Audit results
  if (stats.accessibilityAudit) {
    html += buildAuditResults(stats.accessibilityAudit);
  }

  // Section C: External validators
  html += buildValidatorLinks();

  container.innerHTML = html;
  return container;
}

/**
 * Build accessibility palette empty-state content (just validator links).
 * @returns {HTMLElement}
 */
export function buildAccessibilityEmptyContent() {
  const container = document.createElement('div');
  container.className = 'a11y-panel';
  container.innerHTML = `<div class="palette__empty">Drop a PDF to analyze accessibility</div>${buildValidatorLinks()}`;
  return container;
}

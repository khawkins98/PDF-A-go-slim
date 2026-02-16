/**
 * Accessibility palette UI — trait checklist, lightweight audits, external validator links.
 */
import { escapeHtml } from './helpers.js';

const VALIDATOR_DOWNLOADS = [
  { name: 'veraPDF', desc: 'PDF/A conformance', url: 'https://verapdf.org/software/' },
  { name: 'PAC', desc: 'PDF/UA accessibility', url: 'https://pac.pdf-accessibility.org/en/download' },
];

const VALIDATOR_ONLINE = [
  { name: 'PDFcheck', desc: 'Free, client-side, no login', url: 'https://code.jasonmorris.com/pdfcheck/' },
  { name: 'PDFix', desc: 'PDF/UA validation', url: 'https://pdfix.io/validate-pdf-ua/' },
  { name: 'axes4 checker', desc: 'No login required', url: 'https://check.axes4.com/en/' },
  { name: 'PAVE', desc: 'Login required', url: 'https://pave-pdf.org' },
];

function buildValidatorLinks() {
  const renderList = items => items.map(
    v => `<li><a href="${v.url}" target="_blank" rel="noopener">${escapeHtml(v.name)}</a> &mdash; ${escapeHtml(v.desc)}</li>`
  ).join('');
  return `<div class="a11y-validators">
    <div class="a11y-validators__heading">Further tools to check PDF accessibility</div>
    <div class="a11y-validators__title">Download</div>
    <ul class="a11y-validators__list">${renderList(VALIDATOR_DOWNLOADS)}</ul>
    <div class="a11y-validators__title">Online</div>
    <ul class="a11y-validators__list">${renderList(VALIDATOR_ONLINE)}</ul>
  </div>`;
}

/**
 * Render a pass/fail/neutral status icon.
 * @param {'pass'|'fail'|'neutral'} status
 */
function checkIcon(status) {
  if (status === 'pass') return `<span class="a11y-check__icon a11y-check__icon--pass">\u2713</span>`;
  if (status === 'fail') return `<span class="a11y-check__icon a11y-check__icon--fail">\u2717</span>`;
  return `<span class="a11y-check__icon a11y-check__icon--neutral">\u2014</span>`;
}

function taggedValue(pdfTraits) {
  if (pdfTraits.isTagged) return 'Yes';
  if (pdfTraits.markedStatus === 'false') return 'Marked: false';
  return 'No';
}

function displayDocTitleStatus(val) {
  if (val === true) return 'pass';
  if (val === false) return 'fail';
  return 'neutral';
}

function displayDocTitleValue(val) {
  if (val === true) return 'Enabled';
  if (val === false) return 'Disabled';
  return 'Not configured';
}

function truncate(str, max) {
  if (!str || str.length <= max) return str;
  return str.slice(0, max) + '\u2026';
}

function buildTraitChecklist(pdfTraits) {
  // Basic accessibility — red X when absent
  const basicRows = [
    { label: 'Tagged PDF', status: pdfTraits.isTagged ? 'pass' : 'fail', value: taggedValue(pdfTraits) },
    { label: 'Structure Tree', status: pdfTraits.hasStructTree ? 'pass' : 'fail', value: pdfTraits.hasStructTree ? 'Present' : 'Missing' },
    { label: 'Document Title', status: pdfTraits.title ? 'pass' : 'fail', value: truncate(pdfTraits.title, 60) || 'Not set' },
    { label: 'Display Title', status: displayDocTitleStatus(pdfTraits.displayDocTitle), value: displayDocTitleValue(pdfTraits.displayDocTitle) },
    { label: 'Document Language', status: pdfTraits.lang ? 'pass' : 'fail', value: pdfTraits.lang || 'Not set' },
  ];

  // Conformance standards — neutral dash when absent (not a defect)
  const standardRows = [
    { label: 'PDF/A', status: pdfTraits.isPdfA ? 'pass' : 'neutral', value: pdfTraits.isPdfA ? pdfTraits.pdfALevel : 'Not declared' },
    { label: 'PDF/UA', status: pdfTraits.isPdfUA ? 'pass' : 'neutral', value: pdfTraits.isPdfUA ? 'Yes' : 'Not declared' },
  ];

  const renderRows = rows => rows.map(r =>
    `${checkIcon(r.status)}<span class="a11y-checklist__label">${escapeHtml(r.label)}</span><span class="a11y-checklist__value">${escapeHtml(r.value)}</span>`
  ).join('');

  return `<div class="a11y-checklist">${renderRows(basicRows)}</div>
    <div class="a11y-checklist a11y-checklist--standards">${renderRows(standardRows)}</div>`;
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
  } else {
    sections.push(`<details class="a11y-audit">
      <summary class="a11y-audit__header"><span class="a11y-audit__title">Structure Tree</span><span class="a11y-audit__summary">N/A</span></summary>
      <div class="a11y-audit__body"><p class="a11y-audit__note">Requires tagged PDF with structure tree.</p></div>
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
  container.innerHTML = `<div class="palette__empty">Drop a PDF to analyze accessibility</div>`;
  return container;
}

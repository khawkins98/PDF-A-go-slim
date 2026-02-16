import { initDrag } from './palette.js';
import { buildSoundContent } from './sound.js';

// --- Desktop Patterns ---
// Each pattern's `bg` is a function (dark: boolean) => CSS background-image string.
// Dark themes need light pattern strokes; light themes need dark ones.
function c(dark, a) { return dark ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`; }

const PATTERNS = [
  { id: 'solid', label: 'Solid', bg: () => 'none' },
  {
    id: 'tartan',
    label: 'Tartan',
    bg: (dk) => `repeating-linear-gradient(0deg, ${c(dk,0.06)} 0px, ${c(dk,0.06)} 1px, transparent 1px, transparent 8px),
         repeating-linear-gradient(90deg, ${c(dk,0.06)} 0px, ${c(dk,0.06)} 1px, transparent 1px, transparent 8px),
         repeating-linear-gradient(0deg, ${c(dk,0.03)} 0px, ${c(dk,0.03)} 3px, transparent 3px, transparent 8px),
         repeating-linear-gradient(90deg, ${c(dk,0.03)} 0px, ${c(dk,0.03)} 3px, transparent 3px, transparent 8px)`,
  },
  {
    id: 'bricks',
    label: 'Bricks',
    bg: (dk) => { const s = dk ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';
      return `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16'%3E%3Crect width='16' height='8' fill='none' stroke='${encodeURIComponent(s)}' stroke-width='0.5'/%3E%3Crect x='8' y='8' width='16' height='8' fill='none' stroke='${encodeURIComponent(s)}' stroke-width='0.5'/%3E%3C/svg%3E")`; },
  },
  {
    id: 'diag-stripes',
    label: 'Diagonal',
    bg: (dk) => `repeating-linear-gradient(45deg, transparent, transparent 4px, ${c(dk,0.06)} 4px, ${c(dk,0.06)} 5px)`,
  },
  {
    id: 'dots',
    label: 'Dots',
    bg: (dk) => `radial-gradient(circle, ${c(dk,0.1)} 1px, transparent 1px)`,
    size: '8px 8px',
  },
  {
    id: 'checkerboard',
    label: 'Checker',
    bg: (dk) => `conic-gradient(${c(dk,0.06)} 25%, transparent 25% 50%, ${c(dk,0.06)} 50% 75%, transparent 75%)`,
    size: '12px 12px',
  },
  {
    id: 'weave',
    label: 'Weave',
    bg: (dk) => { const s = dk ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
      return `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12'%3E%3Cpath d='M0 0L12 12M12 0L0 12' stroke='${encodeURIComponent(s)}' stroke-width='0.5' fill='none'/%3E%3C/svg%3E")`; },
  },
  {
    id: 'zigzag',
    label: 'Zigzag',
    bg: (dk) => { const s = dk ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
      return `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='8'%3E%3Cpath d='M0 8L4 0L8 8L12 0L16 8' fill='none' stroke='${encodeURIComponent(s)}' stroke-width='0.5'/%3E%3C/svg%3E")`; },
  },
  {
    id: 'denim',
    label: 'Denim',
    bg: (dk) => `repeating-linear-gradient(135deg, transparent, transparent 2px, ${c(dk,0.04)} 2px, ${c(dk,0.04)} 3px),
         repeating-linear-gradient(45deg, transparent, transparent 2px, ${c(dk,0.03)} 2px, ${c(dk,0.03)} 3px)`,
  },
];

const THEMES = [
  { id: 'platinum',  label: 'Platinum',  swatch: '#dddde5' },
  { id: 'sandstone', label: 'Sandstone', swatch: '#e8e0d0' },
  { id: 'system7',   label: 'System 7',  swatch: '#ffffff' },
  { id: 'dark',      label: 'Dark',      swatch: '#3a3a4e' },
  { id: 'amber',     label: 'Amber',     swatch: '#ffb000' },
  { id: 'ocean',     label: 'Ocean',     swatch: '#4090e0' },
  { id: 'forest',    label: 'Forest',    swatch: '#40a040' },
];

const FONTS = [
  { id: 'system',    label: 'System',    stack: '' },
  { id: 'georgia',   label: 'Georgia',   stack: "Georgia, 'Times New Roman', serif" },
  { id: 'verdana',   label: 'Verdana',   stack: "Verdana, Geneva, sans-serif" },
  { id: 'courier',   label: 'Courier',   stack: "'Courier New', Courier, monospace" },
  { id: 'palatino',  label: 'Palatino',  stack: "Palatino, 'Book Antiqua', 'Palatino Linotype', serif" },
];

function applyFont(id) {
  const font = FONTS.find(f => f.id === id);
  document.body.style.fontFamily = font?.stack || '';
}

// --- localStorage helpers ---
function getLS(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function setLS(key, val) {
  try { localStorage.setItem(key, val); } catch { /* quota */ }
}

// --- Apply state to DOM ---
const DARK_THEMES = new Set(['dark', 'amber', 'ocean', 'forest']);

function isDarkTheme() {
  return DARK_THEMES.has(getLS('pdfa-theme'));
}

function applyPattern(id) {
  const desktop = document.querySelector('.desktop');
  if (!desktop) return;
  const pat = PATTERNS.find((p) => p.id === id) || PATTERNS[0];
  const bg = pat.bg(isDarkTheme());
  if (bg === 'none') {
    desktop.style.backgroundImage = '';
    desktop.style.backgroundSize = '';
  } else {
    desktop.style.backgroundImage = bg;
    desktop.style.backgroundSize = pat.size || '';
  }
}

function applyTheme(id) {
  if (id && id !== 'platinum') {
    document.body.setAttribute('data-theme', id);
  } else {
    document.body.removeAttribute('data-theme');
  }
  // Re-apply pattern — colors depend on dark vs light theme
  applyPattern(getLS('pdfa-pattern') || 'solid');
}

function applyCRT(on) {
  document.body.classList.toggle('crt-overlay', on);
}

/** Toggle CRT scanlines on/off. Returns new state. */
export function toggleCRT() {
  const on = getLS('pdfa-crt') !== 'true';
  setLS('pdfa-crt', on ? 'true' : 'false');
  applyCRT(on);
  // Sync checkbox in Appearance panel if it exists
  const cb = document.querySelector('.appearance-panel input[type="checkbox"]');
  // CRT checkbox is the first one in the Theme section — find by walking
  document.querySelectorAll('.appearance-check input[type="checkbox"]').forEach((el) => {
    if (el.parentElement.textContent.includes('CRT')) el.checked = on;
  });
  return on;
}

/** Cycle to the next theme. */
export function cycleTheme() {
  const ids = THEMES.map((t) => t.id);
  const current = getLS('pdfa-theme') || 'platinum';
  const idx = ids.indexOf(current);
  const next = ids[(idx + 1) % ids.length];
  setLS('pdfa-theme', next);
  applyTheme(next);
  // Sync buttons in Appearance panel if open
  document.querySelectorAll('.theme-btn').forEach((btn) => {
    btn.classList.toggle('theme-btn--active', btn.dataset.theme === next);
  });
}

/** Get the human-readable label of the current theme. */
export function getThemeLabel() {
  const current = getLS('pdfa-theme') || 'platinum';
  const t = THEMES.find((th) => th.id === current);
  return t ? t.label : 'Platinum';
}

const FILTER_CLASSES = ['filter-bw', 'filter-grayscale'];

/**
 * Toggle a display filter (bw or grayscale). Mutually exclusive.
 * @param {'bw'|'grayscale'} mode
 * @returns {boolean} whether the filter is now active
 */
export function toggleFilter(mode) {
  const cls = `filter-${mode}`;
  const isActive = document.body.classList.contains(cls);
  // Remove all filters first
  FILTER_CLASSES.forEach((c) => document.body.classList.remove(c));
  if (!isActive) {
    document.body.classList.add(cls);
    setLS('pdfa-filter', mode);
    return true;
  }
  setLS('pdfa-filter', '');
  return false;
}

// --- Build UI ---
function buildSection(title) {
  const sec = document.createElement('div');
  sec.className = 'appearance-section';
  const h = document.createElement('div');
  h.className = 'appearance-section__title';
  h.textContent = title;
  sec.appendChild(h);
  return sec;
}

function buildCheckbox(label, key, onChange) {
  const row = document.createElement('label');
  row.className = 'appearance-check';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = getLS(key) === 'true';
  cb.addEventListener('change', () => {
    setLS(key, cb.checked ? 'true' : 'false');
    if (onChange) onChange(cb.checked);
  });
  row.appendChild(cb);
  row.appendChild(document.createTextNode(' ' + label));
  return row;
}

export function buildAppearanceContent() {
  const wrap = document.createElement('div');
  wrap.className = 'appearance-panel';

  // --- Section A: Desktop Patterns ---
  const patSec = buildSection('Desktop Pattern');
  const grid = document.createElement('div');
  grid.className = 'pattern-grid';
  const currentPattern = getLS('pdfa-pattern') || 'solid';

  PATTERNS.forEach((pat) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pattern-swatch' + (pat.id === currentPattern ? ' pattern-swatch--active' : '');
    btn.title = pat.label;
    const preview = pat.bg(false); // swatches always use light-mode preview
    if (preview !== 'none') {
      btn.style.backgroundImage = preview;
      if (pat.size) btn.style.backgroundSize = pat.size;
    }
    btn.addEventListener('click', () => {
      grid.querySelectorAll('.pattern-swatch').forEach((s) => s.classList.remove('pattern-swatch--active'));
      btn.classList.add('pattern-swatch--active');
      setLS('pdfa-pattern', pat.id);
      applyPattern(pat.id);
    });
    grid.appendChild(btn);
  });
  patSec.appendChild(grid);
  wrap.appendChild(patSec);

  // --- Section B: Theme / Appearance ---
  const themeSec = buildSection('Theme');
  const currentTheme = getLS('pdfa-theme') || 'platinum';

  const schemeBtns = document.createElement('div');
  schemeBtns.className = 'appearance-scheme-btns';

  THEMES.forEach((t) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theme-btn' + (t.id === currentTheme ? ' theme-btn--active' : '');
    btn.title = t.label;
    btn.dataset.theme = t.id;

    const dot = document.createElement('span');
    dot.className = 'theme-btn__dot';
    dot.style.background = t.swatch;
    btn.appendChild(dot);
    btn.appendChild(document.createTextNode(' ' + t.label));

    btn.addEventListener('click', () => {
      schemeBtns.querySelectorAll('.theme-btn').forEach((b) => b.classList.remove('theme-btn--active'));
      btn.classList.add('theme-btn--active');
      setLS('pdfa-theme', t.id);
      applyTheme(t.id);
    });
    schemeBtns.appendChild(btn);
  });
  themeSec.appendChild(schemeBtns);

  // CRT checkbox
  const crtRow = buildCheckbox('CRT scanlines', 'pdfa-crt', applyCRT);
  themeSec.appendChild(crtRow);

  wrap.appendChild(themeSec);

  // --- Section C: Font ---
  const fontSec = buildSection('Font');
  const fontBtns = document.createElement('div');
  fontBtns.className = 'appearance-scheme-btns';
  const currentFont = getLS('pdfa-font') || 'system';

  FONTS.forEach((f) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theme-btn' + (f.id === currentFont ? ' theme-btn--active' : '');
    btn.title = f.label;
    btn.dataset.font = f.id;
    btn.textContent = f.label;
    if (f.stack) btn.style.fontFamily = f.stack;
    btn.addEventListener('click', () => {
      fontBtns.querySelectorAll('.theme-btn').forEach((b) => b.classList.remove('theme-btn--active'));
      btn.classList.add('theme-btn--active');
      setLS('pdfa-font', f.id);
      applyFont(f.id);
    });
    fontBtns.appendChild(btn);
  });
  fontSec.appendChild(fontBtns);
  wrap.appendChild(fontSec);

  // --- Section D: Sound ---
  wrap.appendChild(buildSoundContent());

  // --- Section E: Visual Effects ---
  const effectsSec = buildSection('Visual Effects');
  effectsSec.appendChild(buildCheckbox('Happy Mac on big savings', 'pdfa-easter-happy-mac'));
  effectsSec.appendChild(buildCheckbox('Sad Mac on zero savings', 'pdfa-easter-sad-mac'));
  wrap.appendChild(effectsSec);

  // --- Reset to Defaults ---
  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'btn btn--small btn--secondary';
  resetBtn.textContent = 'Reset to Defaults';
  resetBtn.style.marginTop = '0.6rem';
  resetBtn.addEventListener('click', () => {
    resetAppearance();
    // Rebuild panel UI to sync all buttons/checkboxes
    const panel = wrap.closest('.palette__body') || wrap.parentElement;
    if (panel) {
      const fresh = buildAppearanceContent();
      panel.replaceChildren(fresh);
    }
  });
  wrap.appendChild(resetBtn);

  return wrap;
}

// --- Reset all appearance settings to defaults ---
export function resetAppearance() {
  const keys = [
    'pdfa-theme', 'pdfa-pattern', 'pdfa-crt', 'pdfa-filter',
    'pdfa-font', 'pdfa-easter-happy-mac', 'pdfa-easter-sad-mac',
    'pdfa-sound-enabled', 'pdfa-sound-volume',
    'pdfa-sound-startup', 'pdfa-sound-drop', 'pdfa-sound-success', 'pdfa-sound-error', 'pdfa-sound-ui',
  ];
  keys.forEach((k) => { try { localStorage.removeItem(k); } catch { /* */ } });
  applyTheme('platinum');
  applyPattern('solid');
  applyFont('system');
  applyCRT(false);
  FILTER_CLASSES.forEach((c) => document.body.classList.remove(c));
}

// --- Init: apply saved state on startup ---
export function initAppearance() {
  // Migrate: old "platinum" was warm beige, now renamed to "sandstone"
  if (getLS('pdfa-theme') === 'platinum') setLS('pdfa-theme', 'sandstone');

  applyPattern(getLS('pdfa-pattern') || 'solid');
  applyTheme(getLS('pdfa-theme') || 'platinum');
  applyCRT(getLS('pdfa-crt') === 'true');
  applyFont(getLS('pdfa-font') || 'system');
  // Restore display filter (B&W / grayscale)
  const savedFilter = getLS('pdfa-filter');
  if (savedFilter && FILTER_CLASSES.includes(`filter-${savedFilter}`)) {
    document.body.classList.add(`filter-${savedFilter}`);
  }
}

// --- Easter eggs ---
function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Classic Mac OS alert — icon strip on left, draggable, click close box to dismiss
function showMacFace(title, svg, bodyHtml) {
  // Remove any existing alert first
  document.querySelector('.mac-face-toast')?.remove();

  const toast = document.createElement('div');
  toast.className = 'mac-face-toast';
  toast.style.top = '30px';
  toast.style.right = '80px';
  toast.innerHTML = `
    <div class="mac-face-toast__title-bar">
      <div class="mac-face-toast__close-box" data-action="close"></div>
      <div class="mac-face-toast__stripes"></div>
      <span class="mac-face-toast__title">${title}</span>
      <div class="mac-face-toast__stripes"></div>
    </div>
    <div class="mac-face-toast__content">
      <div class="mac-face-toast__icon">${svg}</div>
      <div class="mac-face-toast__text">${bodyHtml}</div>
    </div>`;
  function dismiss() {
    toast.classList.add('mac-face-toast--closing');
    toast.addEventListener('transitionend', () => toast.remove());
  }
  toast.querySelector('[data-action="close"]').addEventListener('click', dismiss);
  const titleBar = toast.querySelector('.mac-face-toast__title-bar');
  titleBar.addEventListener('dblclick', () => toast.classList.toggle('mac-face-toast--shaded'));
  document.body.appendChild(toast);
  initDrag(toast, titleBar);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add('mac-face-toast--visible'));
  });
}

// 16x16 pixel-art Happy Mac SVG
const HAPPY_MAC_SVG = `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
<rect x="2" y="1" width="12" height="14" rx="1" fill="#c0c0c0" stroke="#333" stroke-width="0.5"/>
<rect x="4" y="3" width="8" height="7" fill="#7fbf7f" stroke="#333" stroke-width="0.5"/>
<rect x="5" y="5" width="2" height="1" fill="#333"/>
<rect x="9" y="5" width="2" height="1" fill="#333"/>
<rect x="5" y="7" width="1" height="1" fill="#333"/>
<rect x="6" y="8" width="4" height="1" fill="#333"/>
<rect x="10" y="7" width="1" height="1" fill="#333"/>
<rect x="6" y="12" width="4" height="1" rx="0.5" fill="#888"/>
</svg>`;

// 16x16 pixel-art Sad Mac SVG
const SAD_MAC_SVG = `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
<rect x="2" y="1" width="12" height="14" rx="1" fill="#444" stroke="#333" stroke-width="0.5"/>
<rect x="4" y="3" width="8" height="7" fill="#222" stroke="#333" stroke-width="0.5"/>
<line x1="5" y1="4.5" x2="7" y2="6.5" stroke="#c0c0c0" stroke-width="0.7"/>
<line x1="7" y1="4.5" x2="5" y2="6.5" stroke="#c0c0c0" stroke-width="0.7"/>
<line x1="9" y1="4.5" x2="11" y2="6.5" stroke="#c0c0c0" stroke-width="0.7"/>
<line x1="11" y1="4.5" x2="9" y2="6.5" stroke="#c0c0c0" stroke-width="0.7"/>
<rect x="6" y="7" width="4" height="1" fill="#c0c0c0"/>
<rect x="5" y="8" width="1" height="1" fill="#c0c0c0"/>
<rect x="10" y="8" width="1" height="1" fill="#c0c0c0"/>
<rect x="6" y="12" width="4" height="1" rx="0.5" fill="#666"/>
</svg>`;

export function showHappyMac({ pct, original, optimized, saved, savedBytes } = {}) {
  if (getLS('pdfa-easter-happy-mac') !== 'true') return;
  if (prefersReducedMotion()) return;
  let body;
  if (pct) {
    const dialupSeconds = savedBytes > 0 ? (savedBytes * 8) / 56000 : 0;
    const dialupStr = dialupSeconds >= 60
      ? `${(dialupSeconds / 60).toFixed(1)} minutes`
      : `${dialupSeconds.toFixed(1)} seconds`;
    body = `<p><b>${pct}% smaller!</b></p><p>${original} \u2192 ${optimized}</p><p>You saved ${saved} (${dialupStr} at 56 Kbps).</p>`;
  } else {
    body = '<p>Excellent savings!</p>';
  }
  showMacFace('Optimization Complete', HAPPY_MAC_SVG, body);
}

export function showSadMac({ original } = {}) {
  if (getLS('pdfa-easter-sad-mac') !== 'true') return;
  if (prefersReducedMotion()) return;
  const body = original
    ? `<p>This file is already well-optimized at ${original}.</p><p>No further reduction possible.</p>`
    : '<p>Already optimized. No savings.</p>';
  showMacFace('Optimization Notice', SAD_MAC_SVG, body);
}

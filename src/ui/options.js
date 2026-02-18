// --- Presets ---
export const PRESETS = {
  lossless:       { lossy: false, imageQuality: 0.85, unembedStandardFonts: true, subsetFonts: false },
  web:            { lossy: true,  imageQuality: 0.75, unembedStandardFonts: true, subsetFonts: false, maxImageDpi: 150 },
  print:          { lossy: true,  imageQuality: 0.92, unembedStandardFonts: true, subsetFonts: false, maxImageDpi: 300 },
  supercompress:  { lossy: true,  imageQuality: 0.50, unembedStandardFonts: true, subsetFonts: false, maxImageDpi: 72 },
};

const PRESET_HINTS = {
  lossless:       'No quality loss \u2014 recompress, deduplicate, clean up',
  web:            'Lossy JPEG at 75% quality, 150 DPI cap \u2014 best for screens',
  print:          'Lossy JPEG at 92% quality, 300 DPI cap \u2014 best for print',
  supercompress:  'Maximum compression \u2014 50% quality, 72 DPI \u2014 ideal for AI ingestion',
  custom:         'Custom settings',
};

// --- DOM refs (private to this module) ---
const presetBtns = document.querySelectorAll('.tab-control__tab');
const modeBtns = document.querySelectorAll('.mode-btn');
const qualityRow = document.querySelector('.control-row--quality');
const qualitySlider = document.getElementById('quality-slider');
const qualityValue = document.getElementById('quality-value');
const dpiRow = document.querySelector('.control-row--dpi');
const dpiInput = document.getElementById('max-dpi');
const unembedCheckbox = document.getElementById('unembed-fonts');
const subsetCheckbox = document.getElementById('subset-fonts');
const presetHint = document.getElementById('preset-hint');

export function applyPreset(name) {
  const p = PRESETS[name];
  if (!p) return;

  presetBtns.forEach((btn) => {
    btn.classList.toggle('tab-control__tab--active', btn.dataset.preset === name);
    btn.setAttribute('aria-selected', btn.dataset.preset === name ? 'true' : 'false');
  });

  modeBtns.forEach((btn) => {
    btn.classList.toggle('mode-btn--active', btn.dataset.mode === (p.lossy ? 'lossy' : 'lossless'));
  });

  qualityRow.hidden = !p.lossy;
  qualitySlider.value = Math.round(p.imageQuality * 100);
  qualityValue.textContent = Math.round(p.imageQuality * 100);

  dpiRow.hidden = !p.lossy;
  dpiInput.value = p.maxImageDpi || '';

  unembedCheckbox.checked = p.unembedStandardFonts;
  subsetCheckbox.checked = p.subsetFonts;

  if (presetHint) presetHint.textContent = PRESET_HINTS[name] || PRESET_HINTS.custom;
}

export function syncPresetIndicator() {
  const current = collectOptions();
  for (const [name, p] of Object.entries(PRESETS)) {
    if (current.lossy === p.lossy &&
        current.unembedStandardFonts === p.unembedStandardFonts &&
        current.subsetFonts === p.subsetFonts &&
        (!current.lossy || (current.imageQuality === p.imageQuality &&
                            current.maxImageDpi === p.maxImageDpi))) {
      presetBtns.forEach((btn) => {
        btn.classList.toggle('tab-control__tab--active', btn.dataset.preset === name);
        btn.setAttribute('aria-selected', btn.dataset.preset === name ? 'true' : 'false');
      });
      if (presetHint) presetHint.textContent = PRESET_HINTS[name] || PRESET_HINTS.custom;
      return;
    }
  }
  presetBtns.forEach((btn) => {
    btn.classList.remove('tab-control__tab--active');
    btn.setAttribute('aria-selected', 'false');
  });
  if (presetHint) presetHint.textContent = PRESET_HINTS.custom;
}

const PRESET_LABELS = {
  lossless: 'Lossless',
  web: 'Web',
  print: 'Print',
  supercompress: 'Super Compress',
};

/** Return the human-readable label for the currently active preset. */
export function getCurrentPresetLabel() {
  const current = collectOptions();
  for (const [name, p] of Object.entries(PRESETS)) {
    if (current.lossy === p.lossy &&
        current.unembedStandardFonts === p.unembedStandardFonts &&
        current.subsetFonts === p.subsetFonts &&
        (!current.lossy || (current.imageQuality === p.imageQuality &&
                            current.maxImageDpi === p.maxImageDpi))) {
      return PRESET_LABELS[name] || name.charAt(0).toUpperCase() + name.slice(1);
    }
  }
  return 'Custom';
}

export function collectOptions() {
  const lossy = document.querySelector('.mode-btn--active')?.dataset.mode === 'lossy';
  const dpiVal = parseInt(dpiInput.value, 10);
  return {
    lossy,
    imageQuality: lossy ? parseInt(qualitySlider.value, 10) / 100 : undefined,
    maxImageDpi: lossy && dpiVal > 0 ? dpiVal : undefined,
    unembedStandardFonts: unembedCheckbox.checked,
    subsetFonts: subsetCheckbox.checked,
    debug: new URLSearchParams(window.location.search).has('debug'),
  };
}

/**
 * Wire up options panel event listeners.
 * @param {{ onOptionsChanged: () => void }} callbacks
 */
export function initOptionsListeners({ onOptionsChanged }) {
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

  // Stale results detection on any options change
  const optionsPanel = document.getElementById('options-panel');
  optionsPanel.addEventListener('input', onOptionsChanged);
  optionsPanel.addEventListener('change', onOptionsChanged);
  optionsPanel.addEventListener('click', (e) => {
    if (e.target.closest('.tab-control__tab') || e.target.closest('.mode-btn')) {
      requestAnimationFrame(onOptionsChanged);
    }
  });
}

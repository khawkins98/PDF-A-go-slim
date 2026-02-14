// --- Presets ---
export const PRESETS = {
  lossless: { lossy: false, imageQuality: 0.85, unembedStandardFonts: true, subsetFonts: true },
  web:      { lossy: true,  imageQuality: 0.75, unembedStandardFonts: true, subsetFonts: true, maxImageDpi: 150 },
  print:    { lossy: true,  imageQuality: 0.92, unembedStandardFonts: true, subsetFonts: true, maxImageDpi: 300 },
};

// --- DOM refs (private to this module) ---
const presetBtns = document.querySelectorAll('.preset-btn');
const modeBtns = document.querySelectorAll('.mode-btn');
const qualityRow = document.querySelector('.control-row--quality');
const qualitySlider = document.getElementById('quality-slider');
const qualityValue = document.getElementById('quality-value');
const dpiRow = document.querySelector('.control-row--dpi');
const dpiInput = document.getElementById('max-dpi');
const unembedCheckbox = document.getElementById('unembed-fonts');
const subsetCheckbox = document.getElementById('subset-fonts');

export function applyPreset(name) {
  const p = PRESETS[name];
  if (!p) return;

  presetBtns.forEach((btn) => {
    btn.classList.toggle('preset-btn--active', btn.dataset.preset === name);
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
        btn.classList.toggle('preset-btn--active', btn.dataset.preset === name);
      });
      return;
    }
  }
  presetBtns.forEach((btn) => btn.classList.remove('preset-btn--active'));
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
    if (e.target.closest('.preset-btn') || e.target.closest('.mode-btn')) {
      requestAnimationFrame(onOptionsChanged);
    }
  });
}

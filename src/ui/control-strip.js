import { applyPreset, getCurrentPresetLabel } from './options.js';

/**
 * Create the Mac OS 8 Control Strip — a collapsible toolbar at the bottom-left.
 * @param {{ onPresetChange: () => void, onAboutClick: () => void }} callbacks
 * @returns {{ element: HTMLElement, updatePresetIndicator: () => void }}
 */
export function createControlStrip({ onPresetChange, onAboutClick, onAppearanceClick }) {
  const el = document.createElement('div');
  el.className = 'control-strip';
  el.setAttribute('role', 'toolbar');
  el.setAttribute('aria-label', 'Control Strip');

  const modules = document.createElement('div');
  modules.className = 'control-strip__modules';

  // Preset buttons
  const presetNames = ['lossless', 'web', 'print'];
  const presetBtns = presetNames.map((name) => {
    const btn = document.createElement('button');
    btn.className = 'control-strip__btn';
    btn.textContent = name.charAt(0).toUpperCase() + name.slice(1);
    btn.dataset.preset = name;
    btn.type = 'button';
    btn.addEventListener('click', () => {
      applyPreset(name);
      onPresetChange();
    });
    modules.appendChild(btn);
    return btn;
  });

  // Separator
  const sep1 = document.createElement('div');
  sep1.className = 'control-strip__separator';
  modules.appendChild(sep1);

  // GitHub link
  const ghLink = document.createElement('a');
  ghLink.className = 'control-strip__icon-btn';
  ghLink.href = 'https://github.com/khawkins98/PDF-A-go-slim';
  ghLink.target = '_blank';
  ghLink.rel = 'noopener';
  ghLink.title = 'GitHub';
  ghLink.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';
  modules.appendChild(ghLink);

  // About button
  const aboutBtn = document.createElement('button');
  aboutBtn.className = 'control-strip__icon-btn';
  aboutBtn.type = 'button';
  aboutBtn.title = 'About';
  aboutBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
  aboutBtn.addEventListener('click', onAboutClick);
  modules.appendChild(aboutBtn);

  // Separator + Appearance button
  const sep2 = document.createElement('div');
  sep2.className = 'control-strip__separator';
  modules.appendChild(sep2);

  const appearanceBtn = document.createElement('button');
  appearanceBtn.className = 'control-strip__icon-btn';
  appearanceBtn.type = 'button';
  appearanceBtn.title = 'Appearance';
  appearanceBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
  appearanceBtn.addEventListener('click', onAppearanceClick);
  modules.appendChild(appearanceBtn);

  el.appendChild(modules);
  document.body.appendChild(el);

  // Collapse tab — separate element on body so parent transform doesn't trap it
  const tab = document.createElement('button');
  tab.className = 'control-strip__tab';
  tab.type = 'button';
  tab.setAttribute('aria-expanded', 'true');
  tab.setAttribute('aria-label', 'Toggle Control Strip');
  tab.innerHTML = '<div class="control-strip__tab-grip"></div>';
  function positionTab() {
    const collapsed = el.classList.contains('control-strip--collapsed');
    if (collapsed) {
      tab.style.left = '0px';
    } else {
      tab.style.left = `${el.offsetWidth}px`;
    }
  }

  tab.addEventListener('click', () => {
    const collapsed = el.classList.toggle('control-strip--collapsed');
    tab.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    positionTab();
  });
  document.body.appendChild(tab);

  // Position tab after layout
  requestAnimationFrame(positionTab);

  function updatePresetIndicator() {
    const current = getCurrentPresetLabel().toLowerCase();
    presetBtns.forEach((btn) => {
      btn.classList.toggle('control-strip__btn--active', btn.dataset.preset === current);
    });
  }

  updatePresetIndicator();

  return { element: el, updatePresetIndicator };
}

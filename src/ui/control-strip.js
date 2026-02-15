import { cycleTheme, toggleCRT, toggleFilter, getThemeLabel } from './appearance.js';

/**
 * Create the Mac OS 8 Control Strip — a collapsible toolbar at the bottom-left.
 * Display-oriented quick toggles: CRT, theme, B&W, grayscale, plus GitHub/About/Appearance.
 * @returns {{ element: HTMLElement }}
 */
export function createControlStrip({ onAboutClick, onAppearanceClick }) {
  const el = document.createElement('div');
  el.className = 'control-strip';
  el.setAttribute('role', 'toolbar');
  el.setAttribute('aria-label', 'Control Strip');

  const modules = document.createElement('div');
  modules.className = 'control-strip__modules';

  // --- CRT toggle ---
  const crtBtn = document.createElement('button');
  crtBtn.className = 'control-strip__icon-btn';
  crtBtn.type = 'button';
  crtBtn.title = 'CRT scanlines';
  // Monitor icon
  crtBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>';
  if (document.body.classList.contains('crt-overlay')) {
    crtBtn.classList.add('control-strip__icon-btn--active');
  }
  crtBtn.addEventListener('click', () => {
    const on = toggleCRT();
    crtBtn.classList.toggle('control-strip__icon-btn--active', on);
  });
  modules.appendChild(crtBtn);

  // --- Theme cycle ---
  const themeBtn = document.createElement('button');
  themeBtn.className = 'control-strip__icon-btn';
  themeBtn.type = 'button';
  themeBtn.title = `Theme: ${getThemeLabel()}`;
  // Palette/swatch icon
  themeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r="2"/><circle cx="17.5" cy="10.5" r="2"/><circle cx="8.5" cy="7.5" r="2"/><circle cx="6.5" cy="12" r="2"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.5-.7 1.5-1.5 0-.4-.1-.7-.4-1-.3-.3-.4-.6-.4-1 0-.8.7-1.5 1.5-1.5H16c3.3 0 6-2.7 6-6 0-5.5-4.5-10-10-10z"/></svg>';
  themeBtn.addEventListener('click', () => {
    cycleTheme();
    themeBtn.title = `Theme: ${getThemeLabel()}`;
  });
  modules.appendChild(themeBtn);

  // Separator
  const sep0 = document.createElement('div');
  sep0.className = 'control-strip__separator';
  modules.appendChild(sep0);

  // --- B&W toggle ---
  const bwBtn = document.createElement('button');
  bwBtn.className = 'control-strip__icon-btn';
  bwBtn.type = 'button';
  bwBtn.title = 'Black & white';
  // Half-circle B&W icon
  bwBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18" fill="currentColor"/></svg>';
  if (document.body.classList.contains('filter-bw')) {
    bwBtn.classList.add('control-strip__icon-btn--active');
  }
  bwBtn.addEventListener('click', () => {
    const on = toggleFilter('bw');
    bwBtn.classList.toggle('control-strip__icon-btn--active', on);
    // B&W and grayscale are mutually exclusive
    if (on) gsBtn.classList.remove('control-strip__icon-btn--active');
  });
  modules.appendChild(bwBtn);

  // --- Grayscale toggle ---
  const gsBtn = document.createElement('button');
  gsBtn.className = 'control-strip__icon-btn';
  gsBtn.type = 'button';
  gsBtn.title = 'Grayscale';
  // Droplet icon
  gsBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.7c0 0-7 6.3-7 11.3a7 7 0 0 0 14 0c0-5-7-11.3-7-11.3z"/></svg>';
  if (document.body.classList.contains('filter-grayscale')) {
    gsBtn.classList.add('control-strip__icon-btn--active');
  }
  gsBtn.addEventListener('click', () => {
    const on = toggleFilter('grayscale');
    gsBtn.classList.toggle('control-strip__icon-btn--active', on);
    // B&W and grayscale are mutually exclusive
    if (on) bwBtn.classList.remove('control-strip__icon-btn--active');
  });
  modules.appendChild(gsBtn);

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

  return { element: el };
}

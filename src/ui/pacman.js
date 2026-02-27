import { getLS, prefersReducedMotion } from './appearance.js';

/**
 * Pac-Man menu bar easter egg.
 * Appears during long-running optimizations (>10s) — a tiny Pac-Man
 * chomps dots across the menu bar with Blinky trailing behind.
 */

let stripEl = null;
let forceActive = false;

// 11×11 Pac-Man SVG (monochrome circle — mouth animated via CSS clip-path)
const PAC_SVG = `<svg class="pacman-icon" viewBox="0 0 11 11" width="11" height="11">
  <circle cx="5.5" cy="5.5" r="5" fill="currentColor"/>
</svg>`;

// 11×11 ghost SVG (monochrome pixel-art ghost)
const GHOST_SVG = `<svg class="pacman-ghost" viewBox="0 0 11 11" width="11" height="11">
  <path d="M1 10V4.5C1 2 3 0 5.5 0S10 2 10 4.5V10l-1.5-1.5L7 10 5.5 8.5 4 10 2.5 8.5 1 10z" fill="currentColor" opacity="0.55"/>
  <circle cx="3.8" cy="4" r="1.2" fill="var(--color-surface, #fff)"/>
  <circle cx="7.2" cy="4" r="1.2" fill="var(--color-surface, #fff)"/>
  <circle cx="3.2" cy="4.2" r="0.6" fill="currentColor"/>
  <circle cx="6.6" cy="4.2" r="0.6" fill="currentColor"/>
</svg>`;

/**
 * Force-enable the animation (bypasses preference + timer).
 * Activated via `?pacman` URL parameter.
 */
export function forcePacman() {
  forceActive = true;
}

/**
 * Start the Pac-Man animation in the menu bar.
 * No-op if disabled via preference or reduced motion.
 * @param {HTMLElement} menuBarEl - the .menu-bar element
 */
export function startPacman(menuBarEl) {
  if (!forceActive) {
    // Enabled by default (null = never set = enabled). Only disabled if explicitly 'false'.
    if (getLS('pdfa-easter-pacman') === 'false') return;
    if (prefersReducedMotion()) return;
  }
  if (stripEl) return; // already running

  const strip = document.createElement('div');
  strip.className = 'pacman-strip';

  // Build dots (5 small circles)
  for (let i = 0; i < 5; i++) {
    const dot = document.createElement('span');
    dot.className = 'pacman-dot';
    // Evenly space dots across the strip: positions at 20%, 35%, 50%, 65%, 80%
    dot.style.left = `${20 + i * 15}%`;
    strip.appendChild(dot);
  }

  // Pac-Man character
  const pac = document.createElement('span');
  pac.className = 'pacman-char';
  pac.innerHTML = PAC_SVG;
  strip.appendChild(pac);

  // Blinky ghost (trailing behind)
  const ghost = document.createElement('span');
  ghost.className = 'pacman-ghost-wrap';
  ghost.innerHTML = GHOST_SVG;
  strip.appendChild(ghost);

  menuBarEl.appendChild(strip);
  stripEl = strip;

  // Trigger fade-in on next frame
  requestAnimationFrame(() => {
    requestAnimationFrame(() => strip.classList.add('pacman-strip--visible'));
  });
}

/**
 * Stop and remove the Pac-Man animation.
 * Fades out, then removes from DOM.
 */
export function stopPacman() {
  if (!stripEl) return;
  const el = stripEl;
  stripEl = null;

  el.classList.add('pacman-strip--leaving');
  el.addEventListener('transitionend', () => el.remove(), { once: true });
  // Safety: remove after 500ms even if transitionend doesn't fire
  setTimeout(() => el.remove(), 500);
}

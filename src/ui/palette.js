import { playSound } from './sound.js';

// --- Window manager: draggable palettes, WindowShade, z-index ---

let zCounter = 10;
let desktopEl = null;

/** Window registry: id → { title, element, type } */
const windowRegistry = new Map();

/** Register a window in the global registry (for menu bar Window menu). */
export function registerWindow(id, title, element, type = 'palette') {
  windowRegistry.set(id, { title, element, type });
}

/** Returns the window registry Map. */
export function getWindowRegistry() {
  return windowRegistry;
}

/** Returns true if viewport is mobile-width (<768px). */
export function isMobile() {
  return window.innerWidth < 768;
}

/** Set up the .desktop container reference. */
export function initWindowManager() {
  desktopEl = document.querySelector('.desktop');
}

/** Bring an element to the front of the z-index stack. */
export function bringToFront(el) {
  zCounter++;
  el.style.zIndex = zCounter;
}

/**
 * Make an element draggable by its title bar.
 * @param {HTMLElement} el - The element to drag (gets position: absolute)
 * @param {HTMLElement} handleEl - The drag handle (title bar)
 * @param {{ onDragMove?: () => void }} [callbacks] - Optional callbacks
 */
export function initDrag(el, handleEl, callbacks = {}) {
  let startX, startY, startLeft, startTop, dragging = false;

  function onPointerDown(e) {
    // Don't drag when clicking collapse, close, or zoom boxes
    if (e.target.closest('[class*="collapse-box"]') || e.target.closest('[class*="close-box"]') || e.target.closest('[class*="zoom-box"]')) return;
    if (isMobile()) return;

    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    const rect = el.getBoundingClientRect();
    startLeft = rect.left;
    startTop = rect.top;

    el.classList.add('palette--dragging');
    bringToFront(el);

    document.addEventListener('mousemove', onPointerMove);
    document.addEventListener('mouseup', onPointerUp);
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onPointerUp);
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    el.style.left = `${startLeft + dx}px`;
    el.style.top = `${startTop + dy}px`;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    if (callbacks.onDragMove && (Math.abs(dx) > 7 || Math.abs(dy) > 7)) {
      callbacks.onDragMove();
    }
  }

  function onTouchMove(e) {
    if (!dragging) return;
    e.preventDefault();
    const touch = e.touches[0];
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    el.style.left = `${startLeft + dx}px`;
    el.style.top = `${startTop + dy}px`;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    if (callbacks.onDragMove && (Math.abs(dx) > 7 || Math.abs(dy) > 7)) {
      callbacks.onDragMove();
    }
  }

  function onPointerUp() {
    dragging = false;
    el.classList.remove('palette--dragging');
    document.removeEventListener('mousemove', onPointerMove);
    document.removeEventListener('mouseup', onPointerUp);
    document.removeEventListener('touchmove', onTouchMove);
    document.removeEventListener('touchend', onPointerUp);
  }

  handleEl.addEventListener('mousedown', onPointerDown);
  handleEl.addEventListener('touchstart', (e) => {
    if (e.target.closest('[class*="collapse-box"]') || e.target.closest('[class*="close-box"]') || e.target.closest('[class*="zoom-box"]')) return;
    if (isMobile()) return;
    const touch = e.touches[0];
    onPointerDown({ clientX: touch.clientX, clientY: touch.clientY, target: e.target, preventDefault() {} });
  }, { passive: false });

  // Click anywhere on element brings to front
  el.addEventListener('mousedown', () => bringToFront(el));
}

/**
 * Create a floating palette window.
 * @param {{ id: string, title: string, defaultPosition: { top: number, left: number }, width: number, closable?: boolean }} opts
 * @returns {{ element: HTMLElement, bodyEl: HTMLElement, setContent: (nodeOrHtml: Node|string) => void, shade: () => void, unshade: () => void, isShaded: () => boolean }}
 */
export function createPalette({ id, title, defaultPosition, width, closable = false }) {
  const el = document.createElement('div');
  el.className = 'palette';
  el.id = `palette-${id}`;
  el.style.position = 'absolute';
  if (defaultPosition.bottom != null) {
    el.style.bottom = `${defaultPosition.bottom}px`;
  } else {
    el.style.top = `${defaultPosition.top}px`;
  }
  if (defaultPosition.right != null) {
    el.style.right = `${defaultPosition.right}px`;
  } else {
    el.style.left = `${defaultPosition.left}px`;
  }
  el.style.width = `${width}px`;

  // Title bar
  const titleBar = document.createElement('div');
  titleBar.className = 'palette__title-bar';

  // Close box (Mac OS classic: left side of title bar)
  let closeBox = null;
  if (closable) {
    closeBox = document.createElement('div');
    closeBox.className = 'palette__close-box';
    closeBox.setAttribute('aria-label', 'Close');
    closeBox.setAttribute('role', 'button');
    titleBar.appendChild(closeBox);
  }

  const stripes1 = document.createElement('div');
  stripes1.className = 'palette__stripes';
  stripes1.setAttribute('aria-hidden', 'true');

  const titleSpan = document.createElement('span');
  titleSpan.className = 'palette__title';
  titleSpan.textContent = title;

  const stripes2 = document.createElement('div');
  stripes2.className = 'palette__stripes';
  stripes2.setAttribute('aria-hidden', 'true');

  // Zoom box (between stripes and collapse box)
  const zoomBox = document.createElement('div');
  zoomBox.className = 'palette__zoom-box';
  zoomBox.setAttribute('aria-label', 'Zoom');
  zoomBox.setAttribute('role', 'button');

  const collapseBox = document.createElement('div');
  collapseBox.className = 'palette__collapse-box';
  collapseBox.setAttribute('aria-hidden', 'true');

  titleBar.appendChild(stripes1);
  titleBar.appendChild(titleSpan);
  titleBar.appendChild(stripes2);
  titleBar.appendChild(zoomBox);
  titleBar.appendChild(collapseBox);

  // Body
  const bodyEl = document.createElement('div');
  bodyEl.className = 'palette__body';

  // Empty state placeholder
  const emptyEl = document.createElement('div');
  emptyEl.className = 'palette__empty';
  emptyEl.textContent = 'No data yet';
  bodyEl.appendChild(emptyEl);

  el.appendChild(titleBar);
  el.appendChild(bodyEl);

  // Append to desktop
  if (desktopEl) desktopEl.appendChild(el);

  // WindowShade: double-click title bar or click collapse box
  let savedHeight = null;
  function toggleShade() {
    playSound('ui');
    const willShade = !el.classList.contains('palette--shaded');
    if (willShade) {
      // Store explicit height before shading so we can restore it
      savedHeight = el.style.height || null;
      el.style.height = '';
    } else if (savedHeight) {
      el.style.height = savedHeight;
    }
    el.classList.toggle('palette--shaded', willShade);
  }

  titleBar.addEventListener('dblclick', () => {
    toggleShade();
  });

  collapseBox.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleShade();
  });

  // Close box hides the palette
  if (closeBox) {
    closeBox.addEventListener('click', (e) => {
      e.stopPropagation();
      playSound('ui');
      el.hidden = true;
    });
  }

  // --- Zoom box state ---
  let isInStandardState = false;
  let userState = null; // { width, height, top, left }

  function clearZoomState() {
    isInStandardState = false;
    el.classList.remove('palette--zoomed');
  }

  function computeStandardState() {
    const titleBarHeight = titleBar.offsetHeight;
    const bodyPadding = 16; // 8px top + 8px bottom
    const border = 2; // 1px top + 1px bottom
    const contentHeight = bodyEl.scrollHeight;
    const totalHeight = titleBarHeight + contentHeight + bodyPadding + border;

    // Available viewport (account for menu bar 21px + control strip 28px + some margin)
    const maxHeight = Math.round(window.innerHeight * 0.85) - 49;
    const maxWidth = Math.round(window.innerWidth * 0.85);

    const stdHeight = Math.max(80, Math.min(totalHeight, maxHeight));
    const stdWidth = Math.min(el.offsetWidth, maxWidth);

    // Position: keep roughly centered on current position, clamped to viewport
    const rect = el.getBoundingClientRect();
    let stdTop = rect.top;
    let stdLeft = rect.left;

    // Clamp to viewport
    const menuBarOffset = 21;
    stdTop = Math.max(menuBarOffset + 4, Math.min(stdTop, window.innerHeight - stdHeight - 32));
    stdLeft = Math.max(4, Math.min(stdLeft, window.innerWidth - stdWidth - 4));

    return { width: stdWidth, height: stdHeight, top: stdTop, left: stdLeft };
  }

  zoomBox.addEventListener('click', (e) => {
    e.stopPropagation();
    if (el.classList.contains('palette--shaded')) return;

    if (isInStandardState) {
      // Restore user state
      if (userState) {
        el.style.width = `${userState.width}px`;
        el.style.height = userState.height ? `${userState.height}px` : '';
        el.style.top = `${userState.top}px`;
        el.style.left = `${userState.left}px`;
        el.style.right = 'auto';
        el.style.bottom = 'auto';
      }
      isInStandardState = false;
      el.classList.remove('palette--zoomed');
    } else {
      // Save current state
      const rect = el.getBoundingClientRect();
      userState = {
        width: rect.width,
        height: el.style.height ? rect.height : null,
        top: rect.top,
        left: rect.left,
      };

      // Compute and apply standard state
      const std = computeStandardState();
      el.style.width = `${std.width}px`;
      el.style.height = `${std.height}px`;
      el.style.top = `${std.top}px`;
      el.style.left = `${std.left}px`;
      el.style.right = 'auto';
      el.style.bottom = 'auto';
      isInStandardState = true;
      el.classList.add('palette--zoomed');
    }
  });

  // Init drag — dragging 7+ px clears zoomed state per Mac HIG
  initDrag(el, titleBar, {
    onDragMove: clearZoomState,
  });

  // Register in window registry
  registerWindow(id, title, el, closable ? 'closable' : 'palette');

  // API
  function setContent(nodeOrHtml) {
    bodyEl.innerHTML = '';
    if (typeof nodeOrHtml === 'string') {
      bodyEl.innerHTML = nodeOrHtml;
    } else if (nodeOrHtml instanceof Node) {
      bodyEl.appendChild(nodeOrHtml);
    }
  }

  function showEmpty(text = 'No data yet') {
    bodyEl.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'palette__empty';
    empty.textContent = text;
    bodyEl.appendChild(empty);
  }

  return {
    element: el,
    bodyEl,
    setContent,
    showEmpty,
    shade: () => el.classList.add('palette--shaded'),
    unshade: () => el.classList.remove('palette--shaded'),
    isShaded: () => el.classList.contains('palette--shaded'),
    show: () => { el.hidden = false; },
    hide: () => { el.hidden = true; },
  };
}

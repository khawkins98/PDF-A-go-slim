// --- Window manager: draggable palettes, WindowShade, z-index ---

let zCounter = 10;
let desktopEl = null;

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
 */
export function initDrag(el, handleEl) {
  let startX, startY, startLeft, startTop, dragging = false;

  function onPointerDown(e) {
    // Don't drag when clicking collapse boxes
    if (e.target.closest('[class*="collapse-box"]')) return;
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
    if (e.target.closest('[class*="collapse-box"]')) return;
    if (isMobile()) return;
    const touch = e.touches[0];
    onPointerDown({ clientX: touch.clientX, clientY: touch.clientY, target: e.target, preventDefault() {} });
  }, { passive: false });

  // Click anywhere on element brings to front
  el.addEventListener('mousedown', () => bringToFront(el));
}

/**
 * Create a floating palette window.
 * @param {{ id: string, title: string, defaultPosition: { top: number, left: number }, width: number }} opts
 * @returns {{ element: HTMLElement, bodyEl: HTMLElement, setContent: (nodeOrHtml: Node|string) => void, shade: () => void, unshade: () => void, isShaded: () => boolean }}
 */
export function createPalette({ id, title, defaultPosition, width }) {
  const el = document.createElement('div');
  el.className = 'palette';
  el.id = `palette-${id}`;
  el.style.position = 'absolute';
  el.style.top = `${defaultPosition.top}px`;
  el.style.left = `${defaultPosition.left}px`;
  el.style.width = `${width}px`;

  // Title bar
  const titleBar = document.createElement('div');
  titleBar.className = 'palette__title-bar';

  const stripes1 = document.createElement('div');
  stripes1.className = 'palette__stripes';
  stripes1.setAttribute('aria-hidden', 'true');

  const titleSpan = document.createElement('span');
  titleSpan.className = 'palette__title';
  titleSpan.textContent = title;

  const stripes2 = document.createElement('div');
  stripes2.className = 'palette__stripes';
  stripes2.setAttribute('aria-hidden', 'true');

  const collapseBox = document.createElement('div');
  collapseBox.className = 'palette__collapse-box';
  collapseBox.setAttribute('aria-hidden', 'true');

  titleBar.appendChild(stripes1);
  titleBar.appendChild(titleSpan);
  titleBar.appendChild(stripes2);
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
  function toggleShade() {
    el.classList.toggle('palette--shaded');
  }

  titleBar.addEventListener('dblclick', () => {
    toggleShade();
  });

  collapseBox.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleShade();
  });

  // Init drag
  initDrag(el, titleBar);

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

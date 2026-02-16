import { getWindowRegistry, bringToFront } from './palette.js';
import { playSound } from './sound.js';

/**
 * Create the Mac OS 8 menu bar — fixed at the top of the screen.
 * Uses classic Mac press-and-drag menu interaction:
 *   - mousedown on trigger opens the menu and enters drag mode
 *   - while holding, drag into the dropdown; items highlight on hover
 *   - mouseup on an item activates it and closes the menu
 *   - mouseup on the trigger (quick click) enters sticky mode — menu stays open,
 *     click an item or click outside to dismiss
 *   - dragging from one trigger to another switches menus seamlessly
 *
 * @param {{ onAbout: () => void, onAppearance: () => void }} callbacks
 * @returns {{ element: HTMLElement }}
 */
export function createMenuBar({ onAbout, onAppearance } = {}) {
  const el = document.createElement('div');
  el.className = 'menu-bar';
  el.setAttribute('role', 'menubar');

  // --- Shared state across all menus ---
  let activeMenu = null;   // the currently open menu's menuEl
  // Interaction mode: 'closed' | 'drag' | 'sticky'
  //   drag   = mouse button held from trigger press, items activate on mouseup
  //   sticky = click-released on trigger, items activate on click
  let mode = 'closed';

  /** All created menus, keyed by menuEl for lookup. */
  const menus = new Map();
  /** All triggers, for detecting cross-menu drags. */
  const triggers = new Map();

  function closeActive() {
    if (activeMenu) {
      const m = menus.get(activeMenu);
      if (m) m.close();
    }
  }

  function openSpecific(menuEl) {
    if (activeMenu === menuEl) return;
    closeActive();
    const m = menus.get(menuEl);
    if (m) m.open();
  }

  /**
   * Create a menu with trigger + dropdown.
   */
  function createMenu(label, extraClass, buildFn) {
    const menuEl = document.createElement('div');
    menuEl.className = 'menu-bar__menu';

    const trigger = document.createElement('button');
    trigger.className = `menu-bar__trigger ${extraClass}`.trim();
    trigger.type = 'button';
    trigger.textContent = label;
    trigger.setAttribute('aria-haspopup', 'true');
    trigger.setAttribute('aria-expanded', 'false');

    const dropdown = document.createElement('div');
    dropdown.className = 'menu-bar__dropdown';
    dropdown.setAttribute('role', 'menu');
    dropdown.hidden = true;

    menuEl.appendChild(trigger);
    menuEl.appendChild(dropdown);

    let focusedIndex = -1;

    function open() {
      buildFn(dropdown);
      dropdown.hidden = false;
      activeMenu = menuEl;
      focusedIndex = -1;
      trigger.classList.add('menu-bar__trigger--active');
      trigger.setAttribute('aria-expanded', 'true');
    }

    function close() {
      dropdown.hidden = true;
      if (activeMenu === menuEl) activeMenu = null;
      mode = 'closed';
      focusedIndex = -1;
      trigger.classList.remove('menu-bar__trigger--active');
      trigger.setAttribute('aria-expanded', 'false');
    }

    function focusItem(index) {
      const items = dropdown.querySelectorAll('.menu-bar__item');
      if (index >= 0 && index < items.length) {
        focusedIndex = index;
        items[index].focus();
      }
    }

    // --- Mouse interaction: press-and-drag ---

    trigger.addEventListener('mousedown', (e) => {
      e.preventDefault(); // prevent text selection during drag
      if (activeMenu === menuEl && mode === 'sticky') {
        // Already open in sticky mode — toggle closed
        close();
        return;
      }
      openSpecific(menuEl);
      mode = 'drag';
    });

    // When dragging across triggers, switch menus
    trigger.addEventListener('mouseenter', () => {
      if (mode === 'drag' && activeMenu !== menuEl) {
        openSpecific(menuEl);
        // Stay in drag mode
      }
    });

    // Keyboard navigation (works in any mode)
    menuEl.addEventListener('keydown', (e) => {
      if (activeMenu !== menuEl) {
        if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openSpecific(menuEl);
          mode = 'sticky';
          focusItem(0);
        }
        return;
      }

      const items = dropdown.querySelectorAll('.menu-bar__item');
      if (!items.length) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          focusItem(focusedIndex < items.length - 1 ? focusedIndex + 1 : 0);
          break;
        case 'ArrowUp':
          e.preventDefault();
          focusItem(focusedIndex > 0 ? focusedIndex - 1 : items.length - 1);
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          if (focusedIndex >= 0) activateItem(items[focusedIndex]);
          break;
        case 'Escape':
          e.preventDefault();
          close();
          trigger.focus();
          break;
      }
    });

    menus.set(menuEl, { open, close, trigger, dropdown });
    triggers.set(trigger, menuEl);
    return { menuEl, trigger, dropdown };
  }

  // --- Global mouseup handler for drag mode ---

  document.addEventListener('mouseup', (e) => {
    if (mode !== 'drag') return;

    // Find if mouse is over a menu item in the active dropdown
    const target = document.elementFromPoint(e.clientX, e.clientY);
    const item = target?.closest('.menu-bar__item');
    const inActiveDropdown = activeMenu && menus.get(activeMenu)?.dropdown.contains(item);

    if (item && inActiveDropdown) {
      // Activate the item under the cursor
      activateItem(item);
    } else if (target?.closest('.menu-bar__trigger') && triggers.has(target.closest('.menu-bar__trigger'))) {
      // Released on a trigger — enter sticky mode (menu stays open)
      mode = 'sticky';
    } else {
      // Released outside — close
      closeActive();
    }
  });

  // --- Global mousedown handler for sticky mode (click outside to close) ---

  document.addEventListener('mousedown', (e) => {
    if (mode === 'sticky' && activeMenu && !el.contains(e.target)) {
      closeActive();
    }
  });

  // --- Item activation ---

  /** Activate a menu item (call its stored action). */
  function activateItem(itemEl) {
    playSound('ui');
    if (itemEl._menuAction) {
      closeActive();
      itemEl._menuAction();
    } else if (itemEl.tagName === 'A' && itemEl.href) {
      // Link items: open in new tab
      closeActive();
      window.open(itemEl.href, '_blank', 'noopener');
    }
  }

  // --- Item click handlers for sticky mode ---
  // In sticky mode, normal click events fire on items.

  el.addEventListener('click', (e) => {
    if (mode !== 'sticky') return;
    const item = e.target.closest('.menu-bar__item');
    if (item && el.contains(item)) {
      e.preventDefault();
      activateItem(item);
    }
  });

  // --- Helper to build menu items ---

  function makeItem(label, onClick) {
    const item = document.createElement('button');
    item.className = 'menu-bar__item';
    item.type = 'button';
    item.setAttribute('role', 'menuitem');

    const indicator = document.createElement('span');
    indicator.className = 'menu-bar__item-indicator';

    const labelSpan = document.createElement('span');
    labelSpan.className = 'menu-bar__item-label';
    labelSpan.textContent = label;

    item.appendChild(indicator);
    item.appendChild(labelSpan);
    item._menuAction = onClick;
    return item;
  }

  function makeLinkItem(label, href) {
    const item = document.createElement('a');
    item.className = 'menu-bar__item menu-bar__item--link';
    item.href = href;
    item.target = '_blank';
    item.rel = 'noopener';
    item.setAttribute('role', 'menuitem');

    const indicator = document.createElement('span');
    indicator.className = 'menu-bar__item-indicator';

    const labelSpan = document.createElement('span');
    labelSpan.className = 'menu-bar__item-label';
    labelSpan.textContent = label;

    item.appendChild(indicator);
    item.appendChild(labelSpan);
    // _menuAction not needed — activateItem falls back to the href
    return item;
  }

  function makeSeparator() {
    const sep = document.createElement('div');
    sep.className = 'menu-bar__separator';
    sep.setAttribute('role', 'separator');
    return sep;
  }

  // --- Pulse helper for Window menu ---

  function pulseWindow(element) {
    element.classList.remove('palette--focus-pulse');
    void element.offsetWidth;
    element.classList.add('palette--focus-pulse');
    element.addEventListener('animationend', () => {
      element.classList.remove('palette--focus-pulse');
    }, { once: true });
  }

  // =====================
  // 1. App menu (Apple menu style)
  // =====================
  const { menuEl: appMenuEl } = createMenu(
    'PDF-A-go-slim',
    'menu-bar__trigger--app',
    (dropdown) => {
      dropdown.innerHTML = '';

      dropdown.appendChild(makeItem('About PDF-A-go-slim\u2026', () => {
        if (onAbout) onAbout();
      }));

      dropdown.appendChild(makeSeparator());

      dropdown.appendChild(makeItem('Appearance', () => {
        if (onAppearance) onAppearance();
      }));

      dropdown.appendChild(makeSeparator());

      dropdown.appendChild(makeLinkItem('View on GitHub', 'https://github.com/khawkins98/PDF-A-go-slim'));
      dropdown.appendChild(makeLinkItem('PDF-A-go-go', 'https://github.com/khawkins98/PDF-A-go-go'));
      dropdown.appendChild(makeLinkItem('Made by khawkins98', 'https://www.allaboutken.com/'));
    },
  );

  // =====================
  // 2. Window menu
  // =====================
  const { menuEl: windowMenuEl } = createMenu(
    'Window',
    '',
    (dropdown) => {
      dropdown.innerHTML = '';
      const registry = getWindowRegistry();
      const frontEl = getHighestZ();

      for (const [id, { title, element }] of registry) {
        const item = makeItem(title, () => {
          if (element.hidden) element.hidden = false;
          bringToFront(element);
          pulseWindow(element);
        });
        item.dataset.windowId = id;

        // Indicator: diamond for frontmost, checkmark for visible, empty for hidden
        const indicator = item.querySelector('.menu-bar__item-indicator');
        if (element === frontEl) {
          indicator.textContent = '\u25C6'; // diamond
        } else if (!element.hidden) {
          indicator.textContent = '\u2713'; // checkmark
        }

        dropdown.appendChild(item);
      }
    },
  );

  el.appendChild(appMenuEl);
  el.appendChild(windowMenuEl);

  document.body.appendChild(el);
  return { element: el };
}

// --- Helpers ---

function getHighestZ() {
  let maxZ = 0;
  let frontEl = null;
  for (const { element } of getWindowRegistry().values()) {
    const z = parseInt(element.style.zIndex, 10) || 0;
    if (z > maxZ && !element.hidden) {
      maxZ = z;
      frontEl = element;
    }
  }
  return frontEl;
}

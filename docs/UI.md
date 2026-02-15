# UI Design Decisions

Living document tracking the visual design direction for PDF-A-go-slim.

---

## Architecture: Floating Palette Desktop

### Layout

The UI is a **Mac OS 8 multi-window desktop** with a persistent drop zone in the main document window and **draggable, always-visible, shadable floating palettes** for settings, results, inspector, and preview.

```
.desktop (relative positioning context, full viewport)
├── #main-window (.app-window, draggable document window)
│   ├── title-bar (thick ridges, close/zoom/collapse — Platinum chrome)
│   ├── #app
│   │   ├── #drop-zone (ALWAYS visible, never hidden)
│   │   └── #processing (shown below drop zone during optimization)
│   └── .status-bar
├── palette#settings (Settings — preset tabs + advanced options)
├── palette#results (Results — savings hero, downloads, action buttons)
├── palette#inspector (Inspector — stats + object breakdown grid)
└── palette#preview (Preview — before/after PDF viewer)
```

### Window Manager (`src/ui/palette.js`)

Core module (~200 lines) managing the floating palette system:

- **`createPalette({ id, title, defaultPosition, width })`** — Creates a palette DOM element with title bar, body, and collapse box. Returns API: `{ element, bodyEl, setContent(), showEmpty(), shade(), unshade(), isShaded(), show(), hide() }`
- **`initWindowManager()`** — Sets up the `.desktop` container reference
- **`initDrag(el, handleEl)`** — Makes any element draggable by its title bar. Handles mouse and touch events. Disabled on mobile (<768px)
- **`bringToFront(el)`** — Increments z-index counter and applies to element. Any mousedown on a palette calls this
- **`isMobile()`** — Returns true if viewport < 768px

### Drag System

- `mousedown` on title bar (excluding collapse box) starts drag
- `mousemove` on document updates `style.left`/`style.top`
- `mouseup` ends drag, removes `.palette--dragging`
- Touch equivalents for mobile (but drag itself disabled via `isMobile()` check)
- Any `mousedown` on a palette calls `bringToFront()` — z-index counter increments

### WindowShade

Mac OS classic behavior: double-click title bar or click collapse box to collapse palette to just its title bar.

- `.palette--shaded .palette__body { display: none }` — body collapses
- No close box in current implementation — palettes are always present (can be hidden programmatically via `hide()`/`show()` API)

### State Model

The old three-state machine (`idle → processing → results`) with `showState()` toggling hidden sections is replaced by a simpler model:

- **Drop zone** is **always visible** — just dimmed (`.state--dimmed`) during processing
- **Processing section** shown/hidden below drop zone
- **Palettes** are always on screen. Results/Inspector/Preview show empty placeholder text until optimization completes, then populated via `setContent()`
- **Settings palette** always contains the options panel (physically moved there from HTML on init)

### Default Palette Positions

| Palette | Default Position |
|---------|-----------------|
| Main window | `top: 20, left: 20`, `width: 480px` |
| Settings | `top: 20, left: 520`, `width: 260px` |
| Results | `top: 110, left: 520`, `width: 260px` |
| Inspector | `top: 320, left: 20`, `width: 480px` |
| Preview | `top: 280, left: 520`, `width: 600px`, `height: 460px` |

### Mobile (<768px)

```css
.desktop { display: flex; flex-direction: column; gap: 8px; padding: 8px; }
.app-window, .palette { position: static !important; width: 100% !important; }
.palette__title-bar { cursor: default; /* No dragging */ }
```

Palettes stack vertically. Still shadable, not draggable.

---

## Visual Design: Classic Desktop Utility Aesthetic

### Rationale

The original UI was clean but generic — centered cards, rounded corners, blue primary, spacious layout. It looked like every other modern web tool. For a personal project, it lacked personality.

The new direction borrows **structural patterns** from classic desktop applications: window chrome, status bars, dense panels, toolbar-style buttons. The goal is a utility that *feels* like a tool, not a marketing page.

### Design Principles

1. **Structure over skin** — We borrow the *layout grammar* of classic desktop apps, specifically the Mac OS 8 Platinum appearance (title bars with ridges, folder tabs, beveled panels). No pixel fonts, no full OS recreation.
2. **Utility not decoration** — Every pixel earns its place. Dense layouts, compact controls, information-first hierarchy.
3. **Dense not spacious** — Tighter padding, smaller text, more information per screen. The app should feel like opening a utility, not scrolling a landing page.
4. **Modern underneath** — System fonts, responsive layout, CSS custom properties. The retro accent is a thin veneer, not a constraint.

---

## Window Chrome

### Main Document Window

The main `.app-window` is a draggable document window with:
- **Title bar** — 19px height, Platinum-style gray bar with centered title, horizontal ridges extending from title to edges, collapse box (right). `cursor: grab`.
- **Status bar** — bottom bar with sunken fields showing app state. Idle text shows the tagline.
- Decorative elements hidden on mobile.

### Palettes

Floating palette windows with thinner title bars:
- **Title bar** — 15px height, horizontal stripes (tighter pattern than document window ridges), collapse box only (no close or zoom box)
- **Body** — 8px padding, scrollable, max-height 70vh
- `.palette--shaded` collapses body, `.palette--dragging` adds enhanced shadow

### Bevel System

Simplified thin single-pixel borders replacing the original 4-layer depth system. Two CSS variables remain for the rare cases where inset effects are needed (button press states, fieldset grouping):
- `--shadow-raised` / `--shadow-sunken` — 1px inset border pair using `var(--color-border)` and `#fff`.

Most UI elements now use simple `border: 1px solid var(--color-border)` instead of box-shadow bevels. This dramatically reduces visual weight while preserving the retro structure.

### Colors

- Warm cream surface (`#f0ebe0` family) with tan desktop background (`#e8e0d0`), replacing the industrial gray palette
- Borders use soft warm grays (`#c2b9a7`, `#d6cfc1`) instead of `#808080`
- Keep existing category accent colors (fonts purple, images amber, etc.)
- Keep success green and error red
- Primary action color unchanged

---

## HIG Interaction Patterns

Beyond the visual reskin, the interaction patterns themselves follow mid-90s Human Interface Guidelines from Apple (1992/1995) and Microsoft (Win95 Interface Guidelines, Win32 Dialog Box Design).

### Principles Applied

| HIG Principle | What Changed | Guideline Source |
|---------------|-------------|-----------------|
| Multi-window desktop | Content distributed across independent floating palettes instead of hidden sections | Mac OS 8 HIG Ch 5: Floating windows for tool palettes |
| WindowShade | Double-click title bar to collapse to title bar only | Mac OS 8 WindowShade extension |
| Show information upfront | Inspector categories expand by default, stats always visible in palette | Apple HIG: "Don't hide primary information" |
| Right-aligned commit buttons | Action buttons (Re-optimize, Start Over, Cancel) right-aligned | Windows HIG: OK/Cancel/Apply go bottom-right |
| Dense property-sheet layouts | Compact controls, small font sizes throughout | Win32 Dialog Design: compact control spacing |
| Group boxes with legend labels | Advanced settings styled as fieldset with etched border | CA Gen Dialog Design: labeled grouping borders |
| Rich status bar | Processing shows pass label + file counter | Windows HIG: status bars show contextual progress |
| Table/list views | Multi-file results rendered as column-header table | Windows 95 Explorer "details view" pattern |
| Persistent drop zone | Always visible, just dimmed during processing | Mac OS desktop: always accessible |

### Progressive Disclosure

Not everything should be expanded. These remain controlled:

- **Preview palette** — Loads PDF viewer on optimization complete (no lazy-load toggle)
- **Debug info** — Opt-in diagnostic detail. Collapsed behind `?debug` URL flag
- **"Show N more..." within inspector categories** — Categories open, but 50+ objects collapse to first 5

---

## Reference Inspirations

- **Apple Mac OS 8 Human Interface Guidelines ("Platinum")** — Primary visual design reference. [PDF source](http://interface.free.fr/Archives/Apple_HIGOS8_Guidelines.pdf). Specific chapters mapped to implementation:

  | HIG Chapter | Specification | Implementation |
  |-------------|---------------|----------------|
  | Ch 5 (p99-102) Windows | Gray title bar, centered title, horizontal ridges, close/zoom/collapse boxes | `.title-bar` with ridges via `repeating-linear-gradient`, collapse box only (11×11) |
  | Ch 5 (p105-106) Floating windows | Thinner title bar, stripes, close/collapse only | `.palette__title-bar` at 15px, `.palette__stripes`, collapse box only (9×9) |
  | Ch 2 (p42-45), Ch 6 (p110-111) Controls | Folder tabs for multi-pane navigation, active tab merges with content | `.tab-control` folder tabs in Settings palette |
  | Ch 2 (p21-23), Ch 3 (p68-69) Buttons | Default button gets 3px outset ring (black border with gap) | `.btn--default` with concentric `box-shadow` rings |
  | Ch 3 (p67-86) Layout | 20px button height, 58px min width, 12px horizontal button gaps | `.btn` min-height/min-width, `.settings-actions`/`.main-actions` spacing |
  | Ch 2 (p50) Separators | 2px engraved lines (1px dark + 1px light) | `box-shadow` pattern replacing `border-top: 1px solid` |
  | Ch 2 (p46) Placards | Sunken info panel at window bottom | `.status-bar` with engraved top separator, idle tagline |
  | WindowShade | Double-click title bar collapses window to title bar | `.palette--shaded` class, dblclick handler |

- **[Poolsuite.net](https://poolsuite.net/)** — Demonstrates that retro charm comes from thin borders, warm cream colors, generous spacing, and minimal chrome — not heavy 3D bevel recreation. Primary inspiration for the visual lightening pass.
- **98.css** — The original bevel technique (raised/sunken box-shadows). We borrowed the idea but have since simplified to thin 1px borders.
- **Classic property sheets** — Tabbed panels, fieldset grouping, dense control rows.
- **List views / details views** — Column headers, compact row spacing, tabular data presentation.
- **Status bars** — Sunken fields at the bottom with contextual information.
- **[PostHog website redesign](https://posthog.com/)** — In 2025, PostHog (a developer analytics company) redesigned their marketing site as a full Windows-style desktop OS in the browser: draggable windows, start menu, screensaver, functional text editor, games, trash folder with joke files, sound effects. Built by [@ninepixelgrid](https://x.com/ninepixelgrid/status/1965618996990136539) over 6 months. Why it matters: a developer tools company independently chose the same retro desktop metaphor — validating the aesthetic for technical audiences. Key difference: they're a content-rich marketing site with dozens of pages; we're a single-purpose utility. Take selective cues, not their scope. [HN discussion](https://news.ycombinator.com/item?id=45217269).

---

## PostHog Lessons for PDF-A-go-slim

PostHog proves the retro desktop metaphor works for developer tools. The difference is scope. They built an operating system to present a portfolio of products. We build a utility window to do one job. Take the personality and polish, leave the complexity.

### What to adopt

| Lesson | PostHog does... | We should... |
|--------|----------------|-------------|
| Personality in copy | Humor everywhere: joke files in Trash, "Talk to a human" | Voice in empty states, status bar, processing labels. Keep errors clear |
| Easter eggs | Games, photobooth, screensaver, coloring book PDF | Fun zero-savings message, hidden `?` features, credits dialog |
| Transparency as UX | Public roadmap, handbook, pricing breakdown | Surface "why": PDF producer, page count, why passes were skipped |
| Metaphor consistency | OS chrome on everything: 404 page, pricing, blog | Platinum vocabulary on toasts (alert box) and drop overlay (dialog) |
| Progressive disclosure | Desktop icons casual, navbar structured | Protect our existing pattern: new features default hidden |

### What to avoid

Lessons from [HN criticism](https://news.ycombinator.com/item?id=45217269) of PostHog's implementation:

| PostHog problem | Our guardrail |
|----------------|--------------|
| Custom right-click broke browser context menu | Never override native browser behavior |
| Pointer-only, no keyboard scrolling | All controls keyboard-accessible |
| 29% CPU during drags | Our vanilla JS drag is already lightweight |
| 20s mobile load on Firefox Android | Mobile degrades to stacked layout, keep bundle small |
| Accessibility readers broken | Semantic HTML underneath the visual metaphor |

### Scope boundary

- **Yes**: Copy personality, themed transient UI, small easter eggs, transparency, metaphor consistency
- **No**: Start menu, file system navigation, screensaver, games, editable content, sound effects by default

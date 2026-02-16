# UI Architecture & Information Architecture

Reference diagram for the PDF-A-go-slim interface. Documents the state model, screen layouts, component hierarchy, and data flow.

**Visual style:** [Web Desktop](https://en.wikipedia.org/wiki/Web_desktop) — a browser-based application using the desktop metaphor with floating windows, icons, and drag-and-drop. Specifically, a Mac OS 8 Platinum-inspired desktop utility with window chrome, floating palettes, and status bar.

### Design Thesis

Late-90s desktop paradigms (persistent tool palettes, dense information display, always-visible controls) may be a better fit for single-purpose browser utilities than the modern convention of progressive disclosure and minimal surfaces. Browser tools are used in focused bursts, not browsed casually — the same use pattern that floating palettes were designed for.

Three principles guide visual decisions:

1. **Structure over skin.** The Mac OS 8 reference is chosen for its spatial model (floating palettes, persistent tool windows, information always on screen) rather than for decoration. If a Platinum convention makes the tool harder to use, it gets dropped.
2. **Utility, not decoration.** Every visual element — striped title bars, sunken panels, beveled borders — is borrowed because it communicates hierarchy or state, not because it looks retro.
3. **Modern underneath.** System fonts, CSS custom properties, semantic HTML, responsive layout. The aesthetic is a styling layer; the app works without it.

The patterns documented here (palette window manager, theme system, desktop patterns, control strip) are designed to be extractable — they have no dependency on the PDF optimization engine and could serve as the foundation for other web desktop projects, browser tools, or content sites.

**References:**
- Apple Macintosh Human Interface Guidelines (1995)
- [Simone's Web Desktops](https://simone.computer/webdesktops/) — curated directory of 169+ web desktop projects
- [desktops.zip](https://blog.simone.computer/desktops-zip) — history and context of the web desktop movement
- [Toastytech GUI Gallery](http://toastytech.com/guis/index.html) — screenshots of historical desktop operating systems
- [Poolsuite.net](https://poolsuite.net), PostHog (2025 redesign) — contemporary examples

See `PRD.md` for the full rationale and origin story.

---

## State Model

The app uses a simplified two-phase model: **idle/results** vs **processing**. There is no `showState()` function — instead, the drop zone is always visible (dimmed during processing), and four floating palettes hold all content. Palettes show empty placeholders until optimization completes.

```
                   drop / click / "try example" / sample icon drag

                    +------------------------------------+
                    |                                    |
                    v                                    |
              +-----------+     files selected     +------------+
              |           | ---------------------> |            |
              |   IDLE    |                        | PROCESSING |
              |           | <---------+            |            |
              +-----------+   cancel  |            +-----+------+
                    ^                 |                   |
                    |                 +---cancelled-------+
                    |                                     |
                    |   "Start Over"               all files done
                    |                                     |
                    |                              +------v------+
                    +------------------------------|             |
                              "Re-optimize"------->|   RESULTS   |
                                                   |             |
                                                   +-------------+
```

### State visibility rules

| Element              | IDLE    | PROCESSING        | RESULTS                |
|----------------------|---------|-------------------|------------------------|
| `#drop-zone`         | visible | dimmed (`.state--dimmed`) | visible              |
| `#processing`        | hidden  | visible           | hidden                 |
| `#main-actions`      | hidden  | hidden            | visible (Start Over)   |
| `#settings-actions`  | hidden  | hidden            | visible (Re-optimize)  |
| Settings palette     | options panel | options panel | options panel + Re-optimize |
| Results palette      | empty placeholder | empty | hero card + download     |
| Inspector palette    | empty placeholder | empty | stats + object breakdown |
| Preview palette      | empty placeholder | empty | PDF-A-go-go viewer       |
| `#drop-overlay`      | on drag | blocked           | on drag                |
| `.status-bar` left   | tagline | "Optimizing {file}..." | "Saved {pct}% — {sizes}" |

**Key difference from a traditional state machine:** There is no DOM-relocating `showState()` function. Instead:
- `setProcessing(true/false)` toggles the processing section and dims/undims the drop zone
- `renderResults()` populates palette content via `setContent()`
- `startOver()` resets palettes to empty placeholders

**Why this pattern?** Traditional SPAs use a `showState()` function that hides all sections then reveals one. This forces a blank-slate transition between states and requires careful DOM node management. The persistent-drop-zone approach avoids context switching: the user always sees where to drop files, palettes build up progressively, and "empty" palettes with personality text ("Nothing to report yet") make the interface feel alive rather than blank.

**Minimum 800ms processing display time:** Fast files (under 100 KB) can optimize in <100ms. Showing the processing state for a fraction of a second creates a jarring flash — the user can't read the pass labels or register that work happened. The pipeline waits at least 800ms before transitioning to results, creating a deliberate "working" moment that feels intentional. This is a classic UX pattern borrowed from loading spinners (Slack, Stripe) that ensures perceived responsiveness matches actual responsiveness.

---

## Screen Layouts

### IDLE

```
.desktop (relative positioning context, full viewport)
┌─── #main-window (.app-window) ──────────────┐
│ title-bar: PDF-A-go-slim  [collapse]         │
│──────────────────────────────────────────────│
│ #app                                         │
│ ┌── .drop-area ────────────────────────────┐ │
│ │          [PDF icon]                      │ │
│ │        Drop PDFs here                    │ │
│ │     or click to select files             │ │
│ │   or [try an example PDF]               │ │
│ └──────────────────────────────────────────┘ │
│──────────────────────────────────────────────│
│ status-bar: tagline          GitHub · Debug  │
└──────────────────────────────────────────────┘

┌── Settings palette ──────────┐   (always on screen)
│ [Lossless*][Web][Print]      │
│ No quality loss — recompress,│ ← preset hint (updates per tab)
│ deduplicate, subset fonts    │
│ ⚙ Advanced Settings          │ ← gear icon
│   Mode: [Lossless|Lossy]     │
│   [x] Unembed std fonts      │
│   [x] Subset fonts           │
└──────────────────────────────┘

┌── Results palette ───┐   ┌── Inspector palette ─┐
│ Drop a PDF to see    │   │ Drop a PDF to see    │
│ results              │   │ object breakdown     │
└──────────────────────┘   └──────────────────────┘

┌── Preview palette ───┐
│ Drop a PDF to see    │
│ preview              │
└──────────────────────┘
```

**Interactions:**
- Click drop area / keyboard Enter/Space → file picker
- Drag files onto page → `#drop-overlay` appears
- Click "try an example PDF" → fetches tracemonkey.pdf from GitHub
- Drag a sample PDF icon onto drop zone → full-page overlay appears, fetch + optimize on drop
- Click a sample PDF icon → fetch + optimize directly (loading state on icon)
- Preset buttons → `applyPreset()`, updates all advanced controls + hint text
- Any option change → `syncPresetIndicator()` highlights matching preset + updates hint

---

### PROCESSING

```
┌─── #main-window ─────────────────────────────┐
│ title-bar                                    │
│──────────────────────────────────────────────│
│ #drop-zone (dimmed, pointer-events: none)    │
│ ┌── .drop-area ────────────────────────────┐ │
│ │        (dimmed)                          │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ #processing                                  │
│ Optimizing…                                  │
│ ┌── file-item ─────────────────────────────┐ │
│ │ report.pdf                               │ │
│ │ Optimizing images…                       │ │
│ │ [========|============] (shimmer fill)   │ │
│ └──────────────────────────────────────────┘ │
│                                    Cancel    │
│──────────────────────────────────────────────│
│ status-bar: Optimizing report.pdf…           │
└──────────────────────────────────────────────┘
```

**Interactions:**
- Progress bar animates per-pass (`PASS_LABELS` maps internal names to friendly labels)
- Status bar shows current filename + pass label
- Cancel → terminates worker, returns to idle
- Error → shows friendly message + Retry button per file
- Minimum 800ms display time before showing results

**Under the hood — worker orchestration:**

The main thread sends an `ArrayBuffer` to the Web Worker via transfer (not copy): `worker.postMessage({ type: 'optimize', buffer, options }, [buffer])`. The `[buffer]` transfer list moves ownership with zero-copy semantics — critical for large PDFs. The worker posts progress messages per pass, which the UI maps from internal names to friendly labels ("Subsetting fonts" → "Optimizing fonts...") via `PASS_LABELS` in `main.js`. Errors are similarly mapped to user-friendly text via `friendlyError()`.

---

### RESULTS

After optimization, the main window shows "Start Over" and palettes are populated:

```
┌─── #main-window ─────────────────────────────┐
│ title-bar                                    │
│──────────────────────────────────────────────│
│ #drop-zone (still visible)                   │
│ ┌── .drop-area ────────────────────────────┐ │
│ │        Drop PDFs here (ready for more)   │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│                          [ Start Over ]      │
│──────────────────────────────────────────────│
│ status-bar: Saved 32.4% — 1.2MB → 840KB     │
└──────────────────────────────────────────────┘

┌── Settings palette ───────────┐
│ [Lossless*][Web][Print]       │
│ No quality loss — recompress… │ ← preset hint
│ ⚙ Advanced Settings           │
│ ───────────────────────       │
│               [Re-optimize]   │  ← appears after results
└───────────────────────────────┘

┌── Results palette ────────┐
│ report.pdf                │
│ -32.4%     [Download]     │
│ 1.2MB → 840KB             │
│ [========        ]        │
│                           │
│ Images make up 73%…       │
│ Try the [Web preset]      │
└───────────────────────────┘

┌── Inspector palette ─────────────────────────┐
│          Before    After     Saved            │
│ ┃ Fonts   120KB    45KB    −75KB             │
│ ┃ Images  800KB   600KB   −200KB             │
│ ┃ …                                          │
│ Total    1.2MB   840KB    −360KB             │
└──────────────────────────────────────────────┘

┌── Preview palette ────────┐
│ Optimized — 840KB         │
│ ┌────────────────────────┐│
│ │  PDF-A-go-go viewer    ││
│ │                        ││
│ └────────────────────────┘│
└───────────────────────────┘
```

**Information hierarchy:**
1. "Did it work?" — savings % + sizes in Results palette (always prominent)
2. "Get my file" — Download button in Results palette
3. "What happened?" — hint banner + Inspector palette (stats + object breakdown)
4. "Deep dive" — Preview palette (PDF-A-go-go viewer), Debug panel (`?debug` only)
5. "What next?" — Re-optimize in Settings palette, Start Over in main window
6. Status bar — persistent savings summary

**Interactions:**
- Download link → browser downloads optimized PDF
- Hint banner "Web preset" → applies Web preset, triggers stale detection
- Inspector categories → native `<details>` open/close, "Show N more…" toggle
- Preview → auto-loads PDF-A-go-go viewer, resizable via grip
- Changing any option → `checkStaleResults()` adds `.btn--stale` to Re-optimize
- Re-optimize → re-runs `handleFiles(lastFiles)` with current options
- Start Over → cleans up blob URLs, destroys viewers, resets palettes to empty

---

### RESULTS: Multiple Files

Multi-file results use summary card + table rows in the Results palette:

```
┌── Results palette ────────────────────────────────────┐
│              -28.7%         (count-up animation)       │
│     4.1MB → 2.9MB across 3 files                     │
│     [==========          ]                            │
│              [Download All]                            │
│                                                       │
│ Filename      Original  Optimized  Saved              │
│ report.pdf    1.2MB     840KB      -32.4%  [Download] │
│ slides.pdf    2.0MB     1.5MB      -25.0%  [Download] │
│ form.pdf      900KB     560KB      -37.8%  [Download] │
└───────────────────────────────────────────────────────┘
```

**Differences from single-file:**
- Summary card shows aggregate stats + "Download All" button
- Per-file results shown as table rows (Explorer details view style)
- Inspector/Preview palettes show first file's data

---

## Overlay: Drop Target

Shown over any state (except processing) when files are dragged onto the page.

```
+============================================================+
|                                                            |
|  (blurred backdrop, blue-tinted)                           |
|                                                            |
|                      [PDF icon]                            |
|                   Drop to optimize                         |
|                                                            |
+============================================================+
```

Managed by `dragenter`/`dragleave` counter on `document`. Accepts both native `Files` drags and the custom `application/x-pdf-sample` type from sample PDF desktop icons. `pointer-events: none` — files fall through to the drop handler.

**The dragenter/dragleave counter pattern:** A naive implementation that toggles the overlay on `dragenter`/`dragleave` will flicker as the cursor moves over child elements — each child fires its own enter/leave pair. The fix is a counter: increment on `dragenter`, decrement on `dragleave`, show when > 0, hide when === 0. This is a well-known pattern but easy to forget. See `main.js`.

**Custom dataTransfer type system:** Sample PDF desktop icons use `application/x-pdf-sample` as a custom MIME type in `setData()`/`getData()`. This lets the drop handler distinguish "user dragged a sample PDF icon" from "user dragged a file from Finder" without ambiguity. The payload is JSON with `{ name, url }`. The overlay must check for *both* `types.includes('Files')` and `types.includes('application/x-pdf-sample')` — omitting the latter causes the overlay to not appear for internal drags.

---

## Component Hierarchy

```
index.html
  │
  ├── #drop-overlay (conditional, z-index: 999)
  │
  └── .desktop (relative positioning context)
        │
        ├── #main-window (.app-window, draggable)
        │     │
        │     ├── .title-bar
        │     │     ├── .title-bar__ridges (decorative, hidden on mobile)
        │     │     ├── .title-bar__title ("PDF-A-go-slim")
        │     │     ├── .title-bar__ridges
        │     │     └── .title-bar__widgets > .title-bar__collapse-box
        │     │
        │     ├── .debug-banner (conditional, ?debug param)
        │     │
        │     ├── #app (main content area)
        │     │     │
        │     │     ├── #drop-zone (ALWAYS visible, dimmed during processing)
        │     │     │     └── .drop-area (click/drop target)
        │     │     │           ├── .drop-area__content (icon, text, example button)
        │     │     │           └── #file-input (hidden)
        │     │     │
        │     │     ├── #processing (hidden by default, shown during optimization)
        │     │     │     ├── h2 "Optimizing…"
        │     │     │     ├── #file-list (dynamic <li> per file)
        │     │     │     │     └── .file-item
        │     │     │     │           ├── .file-item__name
        │     │     │     │           ├── .file-item__pass (or __error + __retry)
        │     │     │     │           └── .file-item__bar > .file-item__fill
        │     │     │     └── .processing-actions > #btn-cancel
        │     │     │
        │     │     └── #main-actions (hidden until results, contains Start Over)
        │     │           └── #btn-start-over
        │     │
        │     └── .status-bar
        │           ├── #status-left (state-dependent text)
        │           └── #status-right (GitHub + Debug links)
        │
        ├── #palette-settings (created by createPalette())
        │     └── .palette__body
        │           └── #options-panel (moved here from HTML on init)
        │                 ├── .tab-control (Lossless / Web / Print, title tooltips)
        │                 ├── #preset-hint (.tab-control__hint, updates per preset)
        │                 ├── .advanced (<details open>)
        │                 │     └── .advanced__toggle (⚙ gear icon + "Advanced Settings")
        │                 │     └── .advanced__body (mode, quality, DPI, checkboxes)
        │                 └── #settings-actions (Re-optimize button, hidden until results)
        │
        ├── #palette-results (created by createPalette())
        │     └── .palette__body
        │           └── (populated by buildResultsPaletteContent)
        │                 ├── .result-card (single file: hero + download)
        │                 │     ├── .result-card__hero (grid: metrics | download)
        │                 │     │     ├── .results-hero__metrics (filename, pct, sizes, bar)
        │                 │     │     └── .result-card__download (btn)
        │                 │     └── .hint-banner (conditional)
        │                 │
        │                 └── (multi-file: summary card + table)
        │                       ├── .result-card--summary (aggregate pct, Download All)
        │                       └── .result-table
        │                             ├── .result-table__header
        │                             └── .result-table__row (per file)
        │
        ├── #palette-inspector (created by createPalette())
        │     └── .palette__body
        │           └── (populated by buildInspectorPaletteContent)
        │                 ├── .pass-stats (pass-level stats list)
        │                 ├── .inspect-panel (object breakdown grid)
        │                 │     ├── .inspect-panel__header (Before / After / Saved columns)
        │                 │     ├── .inspect-category (<details>) × N
        │                 │     │     ├── <summary> (label, before size, after size, diff)
        │                 │     │     └── .inspect-category__items
        │                 │     │           ├── .inspect-annotation (what optimizer did)
        │                 │     │           └── .inspect-item × N (with Show more toggle)
        │                 │     └── .inspect-panel__total
        │                 └── .debug-panel (<details>, ?debug only)
        │
        ├── #palette-preview (created by createPalette())
        │     └── .palette__body
        │           └── (populated by buildPreviewContent)
        │                 └── .compare-viewer-wrap
        │                       ├── .compare-side__label (size + Powered by link)
        │                       └── .compare-side__viewer (PDF-A-go-go container)
        │
        └── #desktop-icons
              ├── .desktop-icon #icon-readme (static, in HTML)
              ├── .desktop-icon #icon-github (static, in HTML)
              ├── .desktop-icon #icon-appearance (static, in HTML)
              └── .desktop-icon--sample × 3 (dynamic, draggable)
                    ├── svg.desktop-icon__img (PDF document icon)
                    └── .desktop-icon__label (Research Paper / TAM Review / Color Graphics)
```

---

## Options Panel Lifecycle

The `#options-panel` is defined in HTML (so `options.js` module-level `querySelectorAll` finds elements on import), then physically moved into the Settings palette body on init:

```js
settingsPalette.setContent(optionsPanel);  // moves the DOM node
```

The `#settings-actions` div (containing Re-optimize button) lives inside `#options-panel` in HTML and moves with it. It's shown/hidden via `settingsActions.hidden`.

Event listeners survive DOM relocation because they're attached to elements, not positions.

---

## Status Bar

The `.status-bar` sits at the bottom of `#main-window` with two sunken fields:

| State      | Left field (`#status-left`)              | Right field (`#status-right`) |
|------------|------------------------------------------|-------------------------------|
| IDLE       | "Reduce PDF file size — files never leave your device" | GitHub · Debug links |
| PROCESSING | "Optimizing {filename} — {pass label}…"  | GitHub · Debug links          |
| RESULTS    | "Saved {pct}% — {before} → {after}"      | GitHub · Debug links          |

Updated by `setProcessing()` (idle/processing) and `renderResults()` (savings summary).

---

## Module Map

```
main.js
  ├── SAMPLE_PDFS[]             Sample PDF definitions (name, url, label)
  ├── fetchPdfAsFile()          Fetch remote PDF → File object (shared by sample icons + "try example")
  ├── setProcessing()           Toggle processing section + drop zone dimming
  ├── handleFiles()             Main flow: filter PDFs, run workers, render results
  ├── renderResults()           Delegates to UI builders, populates palettes
  ├── checkStaleResults()       Compares current options vs last-run options
  ├── startOver()               Reset palettes, revoke blob URLs, destroy viewers
  ├── animateCountUp()          Count-up animation (passed to card builders)
  │
  ├── ui/palette.js              Window manager (~200 lines)
  │     ├── initWindowManager()    Set up .desktop container reference
  │     ├── createPalette()        Create floating palette with title bar + body
  │     ├── initDrag()             Make any element draggable by handle
  │     ├── bringToFront()         Increment z-index counter on element
  │     └── isMobile()             Viewport < 768px check
  │
  ├── ui/result-card.js          Result card builders
  │     ├── buildResultsPaletteContent()   Full Results palette content (single or multi)
  │     ├── buildInspectorPaletteContent() Full Inspector palette content (stats + breakdown)
  │     ├── buildSingleFileCard()          Hero card with download button
  │     ├── buildSummaryCard()             Multi-file aggregate card
  │     ├── buildFileTableHeader()         Column headers for multi-file table
  │     ├── buildFileCard()                Per-file table row
  │     ├── buildHeroContent()             Shared hero section (pct, sizes, bar)
  │     └── buildHintBanner()              Conditional "try Web preset" banner
  │
  ├── ui/compare.js              PDF preview viewers
  │     ├── buildCompareSection()     <details> with lazy PDF-A-go-go viewer
  │     ├── buildPreviewContent()     Immediate-load viewer for Preview palette
  │     └── destroyAllComparisons()   Cleanup viewers + blob URLs
  │
  ├── ui/stats.js                Pass-level statistics
  │     ├── buildStatsDetail()        Pass stats list (active passes only)
  │     ├── buildDebugPanel()         Debug tables (timings, skip reasons, conversions)
  │     └── formatPassStats()         Single pass → human-readable summary
  │
  ├── ui/inspector.js            Object breakdown grid
  │     ├── buildInspectPanel()       Before/after category grid with item rows
  │     └── initInspectorInteractions()  Delegated "Show more" click handler
  │
  ├── ui/options.js              Options panel logic
  │     ├── collectOptions()          Read UI state → options object
  │     ├── applyPreset()             Apply a named preset to all controls
  │     ├── syncPresetIndicator()     Highlight matching preset button
  │     ├── getCurrentPresetLabel()   "Lossless" / "Web" / "Print" / "Custom"
  │     └── initOptionsListeners()    Wire up event handlers + stale detection
  │
  └── ui/helpers.js              Shared utilities
        ├── formatSize()             Bytes → human-readable string
        └── escapeHtml()             Sanitize for innerHTML
```

---

## Micro-Interactions & Visual Feedback

| Element | Trigger | Duration | Notes |
|---------|---------|----------|-------|
| `.toast` | Non-PDF files dropped | 4s + 300ms fade | Fixed bottom-center |
| `.debug-banner` | `?debug` URL param | Persistent | Top of `#main-window` |
| `.drop-overlay` | Files dragged over page | While dragging | Full-page, pointer-events: none |
| `.btn--stale` animation | Settings changed after results | 1x 2s pulse | On Re-optimize button |
| Count-up animation | Results displayed | 600ms ease-out | On savings percentage |
| Bar fill animation | Results displayed | 400ms ease | CSS transition on width |

### Stale Results Detection

After results render, the system watches for option changes. `renderResults()` stores `lastRunOptions = JSON.stringify(collectOptions())`. Every subsequent option change fires `checkStaleResults()`, which compares the current JSON against the stored snapshot. If different, the Re-optimize button gets a `.btn--stale` pulse animation. If the user reverts to the original settings, the indicator disappears. Simple JSON comparison — no diffing, no state management library.

### Count-Up Animation

The savings percentage animates from 0 to the target using `requestAnimationFrame` + `performance.now()` with cubic ease-out (`1 - (1-t)^3`) over 600ms. The progress bar width animates simultaneously via CSS transition (400ms).

**The two-frame trick:** Both values are set to 0 on creation, then updated via `requestAnimationFrame` on the next frame. Setting both in the same frame doesn't trigger CSS transitions — the browser batches style changes. This is a general pattern for any "animate from initial state" scenario.

---

## Reusable UI Patterns

The following patterns have no dependency on the PDF optimization engine. They're designed as extractable components that could serve other browser tools or content sites using a similar retro desktop aesthetic.

### Floating Palette Window Manager

**Why palettes?** The tool surfaces four categories of information simultaneously (settings, results, object breakdown, preview). Tabs force context switching. Stacked panels require scrolling. Floating palettes let users arrange by priority and keep everything visible — the same reason Photoshop, Illustrator, and classic Mac applications used this pattern.

**API surface** (`palette.js`, ~200 lines, zero dependencies):
- `createPalette({ title, id, closable, defaultPosition })` — factory that returns `{ element, setContent(), show(), hide() }`
- `initDrag(element, handle)` — make any element draggable by its handle
- `bringToFront(element)` — increment z-index counter, O(1), no collision risk
- `isMobile()` — viewport < 768px check (disables drag on small screens)

**Z-index management** is a simple counter:

```js
let zCounter = 100;
export function bringToFront(el) { el.style.zIndex = ++zCounter; }
```

No z-index stack to maintain. Called on mousedown/touchstart of any palette.

**WindowShade** (double-click title bar or click collapse box): stores explicit height before collapsing, restores on expand. Direct port of Mac OS 7's WindowShade behavior.

**Touch support:** Both `mousedown` and `touchstart` handlers registered. `touchmove` uses `{ passive: false }` for `preventDefault()` (prevents scroll while dragging).

### Desktop Pattern Generator

Nine patterns generated entirely with CSS — no images, no canvas:

| Pattern | CSS technique |
|---------|--------------|
| Tartan, diagonal, zigzag | `repeating-linear-gradient` |
| Dots | `radial-gradient` |
| Checkerboard | `conic-gradient` |
| Bricks, weave, denim | Inline SVG `data:image/svg+xml` |

Each pattern adapts to light/dark themes via a single helper function `c(dark, a)` that generates RGBA values based on the current theme. Light themes use dark strokes on cream; dark themes use light strokes on dark surfaces. The patterns and themes are **orthogonal** — any of 9 patterns × 5 themes works. All state persists to `localStorage`.

### Theme System

Five themes (Platinum, Dark, Amber, Ocean, Forest) applied by swapping CSS custom properties on the root element. B&W and Grayscale are CSS `filter` toggles on `<body>`, mutually exclusive. The theme switcher is a button in the Control Strip that cycles through themes, with the current theme name shown as a tooltip.

### Control Strip

A Mac OS 8-style collapsible toolbar fixed at bottom-left. Contains toggle buttons for visual modes (CRT scanlines, B&W, Grayscale), a theme cycle button, and navigation links (GitHub, About, Appearance). Collapses via a grab tab whose horizontal position is dynamically calculated from the strip width. Full-width on mobile.

---

## PDF-A-go-go Integration

[PDF-A-go-go](https://github.com/khawkins98/PDF-A-go-go) is the sibling project — a lightweight, embeddable PDF viewer built on PDF.js with tile-based rendering. PDF-A-go-slim was born from trying to optimize demo PDFs for PDF-A-go-go's showcase page (see `PRD.md` origin story). The two projects share a design philosophy: no server, no framework, pure browser.

### Lazy Loading

PDF-A-go-go JS + CSS (~550 KB) are loaded from CDN only when the Preview palette is first populated. A shared `loadPromise` deduplicates concurrent load requests. This keeps PDF-A-go-slim's own bundle small — the heavy PDF.js rendering code is external and optional.

### ResizeObserver Lifecycle

PDF-A-go-go doesn't support dynamic resizing — viewers must be destroyed and recreated at new dimensions. When a user drags the palette resize grip, this creates a lifecycle conflict with ResizeObserver:

1. **Observe the palette**, not the viewer container — PDF-A-go-go injects DOM that changes container size, creating a feedback loop
2. **Freeze palette height** before removing the old viewer — prevents collapse when content disappears
3. **Disconnect the observer** during reinit — prevents re-firing while rebuilding
4. **Skip the first fire** — ResizeObserver fires on initial registration, which isn't a resize
5. **400ms debounce** — grip dragging fires many events; only reinit after the user stops

The core insight: ResizeObserver + destroy/recreate is fundamentally at odds with itself. The solution is aggressive lifecycle management.

---

## Personality Layer

Small, discoverable surprises that reinforce the retro aesthetic without interfering with core function. All animated items respect `prefers-reduced-motion`. State persists via `localStorage`.

### Startup Chime

A 4-note C major chord synthesized with Web Audio API (`OscillatorNode` × 4 with harmonics). Plays once on the first file drop, never again in the same session. Togglable via Appearance palette.

### Happy Mac / Sad Mac

Pixel-art 16×16 SVG faces shown as brief floating palettes:

- **Happy Mac** (savings >= 30%): green screen, smiley mouth, savings summary with "56K modem time saved" joke
- **Sad Mac** (savings <= 0%): X eyes, frown, "already well-optimized" message

Both are draggable and shadable — they're just palettes with personality.

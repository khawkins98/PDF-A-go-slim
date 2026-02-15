# UI Architecture & Information Architecture

Reference diagram for the PDF-A-go-slim interface. Documents the state model, screen layouts, component hierarchy, and data flow.

**Visual style:** Classic desktop utility aesthetic with window chrome, floating palettes, and status bar. See `docs/UI.md` for design decisions.

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

┌── Settings palette ──┐   (always on screen)
│ [Lossless*][Web][Print] │
│ ▸ Advanced Settings     │
│   Mode: [Lossless|Lossy]│
│   [x] Unembed std fonts │
│   [x] Subset fonts      │
└─────────────────────────┘

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
- Preset buttons → `applyPreset()`, updates all advanced controls
- Any option change → `syncPresetIndicator()` highlights matching preset

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

┌── Settings palette ───────┐
│ [Lossless*][Web][Print]   │
│ ▸ Advanced Settings       │
│ ─────────────────────     │
│             [Re-optimize] │  ← appears after results
└───────────────────────────┘

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
        │                 ├── .tab-control (Lossless / Web / Print)
        │                 ├── .advanced (<details open>)
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

## Toast / Transient UI

| Element | Trigger | Duration | Notes |
|---------|---------|----------|-------|
| `.toast` | Non-PDF files dropped | 4s + 300ms fade | Fixed bottom-center |
| `.debug-banner` | `?debug` URL param | Persistent | Top of `#main-window` |
| `.drop-overlay` | Files dragged over page | While dragging | Full-page, pointer-events: none |
| `.btn--stale` animation | Settings changed after results | 1x 2s pulse | On Re-optimize button |
| Count-up animation | Results displayed | 600ms ease-out | On savings percentage |
| Bar fill animation | Results displayed | 400ms ease | CSS transition on width |

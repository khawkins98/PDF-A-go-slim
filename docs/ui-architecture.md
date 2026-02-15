# UI Architecture & Information Architecture

Reference diagram for the PDF-A-go-slim interface. Documents the state machine, screen layouts, component hierarchy, and data flow.

**Visual style:** Classic desktop utility aesthetic with window chrome, beveled panels, and status bar. See `docs/UI.md` for design decisions.

---

## State Machine

The app has three mutually exclusive states managed by `showState()` in `main.js`. The `#options-panel` DOM node physically relocates between states. The status bar text updates with each state transition.

```
                         drop / click / "try example"
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

| Element              | IDLE    | PROCESSING | RESULTS                  |
|----------------------|---------|------------|--------------------------|
| `#drop-zone`         | visible | hidden     | hidden                   |
| `#options-panel`     | visible (in `#options-idle-slot`) | hidden | visible (in `#results-settings-body`) |
| `#processing`        | hidden  | visible    | hidden                   |
| `#results`           | hidden  | hidden     | visible                  |
| `#drop-overlay`      | on drag | blocked    | on drag                  |
| `.status-bar` left   | "Ready" | "Optimizing {file}..." | "Saved {pct}% — {sizes}" |

---

## Screen Layouts

### IDLE

```
+== .app-window ============================================+
| .title-bar                                                |
| PDF-A-go-slim   Reduce PDF file size — files never...     |
+===========================================================+
|                                                           |
| #app                                                      |
|                                                           |
| +-- .drop-area (sunken panel) -------------------------+  |
| |                                                      |  |
| |                   [PDF icon]                         |  |
| |                                                      |  |
| |                 Drop PDFs here                       |  |
| |              or click to select files                |  |
| |          or [try an example PDF]                     |  |
| |                                                      |  |
| +------------------------------------------------------+  |
|                                                           |
| +-- #options-idle-slot ---------------------------------+  |
| | #options-panel                                       |  |
| |                                                      |  |
| | Preset: [Lossless*] [Web] [Print]  (raised buttons)  |  |
| |                                                      |  |
| | +-- .advanced (etched group box) -----------------+  |  |
| | | > Advanced Settings                             |  |  |
| | |   Mode: [Lossless*|Lossy]                      |  |  |
| | |   Image quality: [===|=====] 85  (lossy only)  |  |  |
| | |   Max image DPI: [150]           (lossy only)  |  |  |
| | |   [x] Unembed standard fonts                   |  |  |
| | |   [x] Subset embedded fonts                    |  |  |
| | +------------------------------------------------+  |  |
| +------------------------------------------------------+  |
|                                                           |
+== .status-bar ============================================+
| Ready                              GitHub · Debug         |
+===========================================================+
```

**Interactions:**
- Click drop area / keyboard Enter/Space -> file picker
- Drag files onto page -> `#drop-overlay` appears
- Click "try an example PDF" -> fetches tracemonkey.pdf from GitHub
- Preset buttons -> `applyPreset()`, updates all advanced controls
- Any option change -> `syncPresetIndicator()` highlights matching preset

---

### PROCESSING

```
+== .app-window ============================================+
| .title-bar                                                |
| PDF-A-go-slim   Reduce PDF file size — files never...     |
+===========================================================+
|                                                           |
| #app                                                      |
|                                                           |
| Optimizing...                                             |
|                                                           |
| +-- file-item (etched panel) --------------------------+  |
| | report.pdf                                           |  |
| | Optimizing images...                                 |  |
| | [========|============] (sunken track, shimmer fill)  |  |
| +------------------------------------------------------+  |
|                                                           |
| +-- file-item (error) ---------------------------------+  |
| | secret.pdf                                           |  |
| | This PDF is password-protected  [Retry]              |  |
| | [######################################] (red fill)   |  |
| +------------------------------------------------------+  |
|                                                           |
|                        Cancel                             |
|                                                           |
+== .status-bar ============================================+
| Optimizing report.pdf...                GitHub · Debug     |
+===========================================================+
```

**Interactions:**
- Progress bar animates per-pass (`PASS_LABELS` maps internal names to friendly labels)
- Status bar shows current filename being processed
- Cancel -> terminates worker, returns to IDLE
- Error -> shows friendly message + Retry button per file
- Minimum 800ms display time before transitioning to RESULTS

---

### RESULTS: Single File (90% case)

```
+== .app-window ============================================+
| .title-bar                                                |
| PDF-A-go-slim   Reduce PDF file size — files never...     |
+===========================================================+
|                                                           |
| #app                                                      |
|                                                           |
| +-- .result-card (etched panel) -----------------------+  |
| |                                                      |  |
| |  .result-card__hero (grid: metrics left, download)   |  |
| |  report.pdf                                          |  |
| |  -32.4%                        [ Download ]          |  |
| |  1.2 MB -> 840 KB                                    |  |
| |  [========        ] (sunken track, animated bar)      |  |
| |                                                      |  |
| |  +-- .hint-banner (conditional) -----------------+   |  |
| |  | Images make up 73% of this file.              |   |  |
| |  | Try the [Web preset] for better compression.  |   |  |
| |  +-----------------------------------------------+   |  |
| |                                                      |  |
| |  > What was optimized          <details/summary>     |  |
| |  > Preview                     <details/summary>     |  |
| |  > Debug info   (?debug only)  <details/summary>     |  |
| |                                                      |  |
| +------------------------------------------------------+  |
|                                                           |
| +-- .results-settings (etched panel) ------------------+  |
| |  Settings: **Lossless**      [Change settings]       |  |
| +------------------------------------------------------+  |
|                                                           |
|            [ Re-optimize ]    [ Start Over ]              |
|                                                           |
+== .status-bar ============================================+
| Saved 32.4% — 1.2 MB -> 840 KB        GitHub · Debug     |
+===========================================================+
```

**Information hierarchy (top to bottom):**
1. "Did it work?" -- savings percentage + sizes (always visible, prominent)
2. "Get my file" -- download button (one clear location)
3. "What happened?" -- hint banner + pass summary + object breakdown (visible but secondary)
4. "Deep dive" -- preview (auto-open for single file, collapsed for batch), debug (collapsed by default)
5. "What next?" -- settings bar + action buttons
6. Status bar -- persistent savings summary

**Interactions:**
- Download link -> browser downloads optimized PDF
- Hint banner "Web preset" -> applies Web preset, triggers stale detection
- Each `<details>` section -> native open/close toggle
- Preview -> auto-opens for single-file results; lazy-loads PDF-A-go-go viewer on first expand, destroys on collapse
- "Change settings" -> expands relocated `#options-panel` inline
- Changing any option -> settings bar highlights with `.results-settings--stale`
- Re-optimize -> re-runs `handleFiles(lastFiles)` with current options
- Start Over -> cleans up blob URLs, destroys viewers, returns to IDLE

---

### RESULTS: Multiple Files

```
+== .app-window ============================================+
| .title-bar                                                |
+===========================================================+
|                                                           |
| +-- .result-card--summary (etched panel) --------------+  |
| |                   -28.7%        (count-up animation)  |  |
| |         4.1 MB -> 2.9 MB across 3 files              |  |
| |         [==========          ] (animated bar)         |  |
| |              [ Download All ]                         |  |
| +------------------------------------------------------+  |
|                                                           |
| +-- .result-file-card (etched panel) ------------------+  |
| | report.pdf              1.2 MB -> 840 KB  -32.4%     |  |
| | [ Download ]                                         |  |
| |  > What was optimized                                |  |
| |  > Preview                                           |  |
| +------------------------------------------------------+  |
|                                                           |
| +-- .results-settings ----------------------------------+  |
| |  Settings: **Lossless**      [Change settings]       |  |
| +------------------------------------------------------+  |
|                                                           |
|            [ Re-optimize ]    [ Start Over ]              |
|                                                           |
+== .status-bar ============================================+
| Saved 28.7% — 4.1 MB -> 2.9 MB        GitHub · Debug     |
+===========================================================+
```

**Differences from single-file:**
- Summary card shows aggregate stats + "Download All" button
- Per-file cards are compact: filename + sizes in header row
- No hero animation on individual file cards
- Each file card still has its own disclosure sections + download

---

## Overlay: Drop Target

Shown over any state (except PROCESSING) when files are dragged onto the page.

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

Managed by `dragenter`/`dragleave` counter on `document`. Pointer-events: none (files fall through to the drop handler).

---

## Component Hierarchy

```
index.html
  |
  +-- #drop-overlay (conditional, z-index: 999)
  |
  +-- .app-window
        |
        +-- .title-bar
        |     +-- .title-bar__title ("PDF-A-go-slim")
        |     +-- .title-bar__subtitle ("Reduce PDF file size...")
        |
        +-- .debug-banner (conditional, ?debug param)
        |
        +-- #app (main content area)
        |     |
        |     +-- #drop-zone  [IDLE state]
        |     |     +-- .drop-area (click/drop target, sunken panel)
        |     |           +-- .drop-area__content (icon, text, example button)
        |     |           +-- #file-input (hidden)
        |     |
        |     +-- #options-idle-slot  [IDLE state]
        |     |     +-- #options-panel  <-- physically moves between here and results
        |     |           +-- .presets (Lossless / Web / Print raised buttons)
        |     |           +-- .advanced (<details>, etched group box)
        |     |                 +-- .advanced__body (mode, quality, DPI, checkboxes)
        |     |
        |     +-- #processing  [PROCESSING state]
        |     |     +-- h2 "Optimizing..."
        |     |     +-- #file-list (dynamic <li> per file)
        |     |     |     +-- .file-item (etched panel)
        |     |     |           +-- .file-item__name
        |     |     |           +-- .file-item__pass (or __error + __retry)
        |     |     |           +-- .file-item__bar > .file-item__fill (sunken track)
        |     |     +-- .processing-actions > #btn-cancel
        |     |
        |     +-- #results  [RESULTS state]
        |           +-- #results-summary
        |           |     +-- .result-card  (single file, etched panel)
        |           |     |     +-- .result-card__hero (grid: metrics | download)
        |           |     |     |     +-- .results-hero__metrics (filename, pct, sizes, bar)
        |           |     |     |     +-- .result-card__download (raised button)
        |           |     |     +-- .hint-banner (conditional)
        |           |     |     +-- <details> "What was optimized" (pass stats + inspector)
        |           |     |     +-- <details> "Preview" (lazy PDF viewer)
        |           |     |     +-- <details> "Debug info" (?debug only)
        |           |     |
        |           |     +-- .result-card--summary  (multi-file, instead of above)
        |           |           +-- .result-card__hero (aggregate pct, sizes)
        |           |           +-- "Download All" button
        |           |
        |           +-- #results-files  (multi-file only)
        |           |     +-- .result-file-card  (per file, etched panel)
        |           |           +-- .result-file-card__header (name + sizes + pct)
        |           |           +-- .result-file-card__download (raised button)
        |           |           +-- .hint-banner (conditional)
        |           |           +-- <details> "What was optimized"
        |           |           +-- <details> "Preview"
        |           |           +-- <details> "Debug info" (?debug only)
        |           |
        |           +-- #results-settings (etched panel)
        |           |     +-- .results-settings__summary
        |           |     |     +-- "Settings: **Lossless**"
        |           |     |     +-- [Change settings] button
        |           |     +-- .results-settings__body (hidden, expandable)
        |           |           +-- #options-panel  <-- relocated here from idle slot
        |           |
        |           +-- .results-actions
        |                 +-- #btn-reoptimize (raised button)
        |                 +-- #btn-start-over (raised button)
        |
        +-- .status-bar
              +-- .status-bar__left (#status-left — state text)
              +-- .status-bar__right (#status-right — GitHub + Debug links)
```

---

## Options Panel Relocation

The `#options-panel` is a single DOM node that moves between two slots:

```
IDLE / START OVER:
  #options-idle-slot
    +-- #options-panel    <-- lives here, visible

PROCESSING:
  (stays in last slot, hidden)

RESULTS:
  #results-settings-body
    +-- #options-panel    <-- moved here by showState('results')
```

Event listeners survive DOM relocation. CSS override `.results-settings__body .options-panel` removes default margins/borders when inside the settings bar.

---

## Status Bar

The `.status-bar` sits at the bottom of `.app-window` with two sunken fields:

| State | Left field (`#status-left`) | Right field (`#status-right`) |
|-------|---------------------------|------------------------------|
| IDLE | "Ready" | GitHub · Debug links |
| PROCESSING | "Optimizing {filename}..." | GitHub · Debug links |
| RESULTS | "Saved {pct}% — {before} → {after}" | GitHub · Debug links |

Updated by `showState()` (idle/processing defaults) and `renderResults()` (savings summary).

---

## Module Map

```
main.js
  +-- showState()              State machine, DOM visibility, options relocation, status bar
  +-- handleFiles()            Main flow: filter PDFs, run workers, render results
  +-- renderResults()          Delegates to result-card.js builders, updates status bar
  +-- checkStaleResults()      Compares current options vs last-run options
  +-- animateCountUp()         Count-up animation (passed to card builders)
  |
  +-- ui/result-card.js
  |     +-- buildSingleFileCard()   Single-file result card (hero + disclosures)
  |     +-- buildSummaryCard()      Multi-file aggregate card
  |     +-- buildFileCard()         Multi-file per-file compact card
  |     +-- buildHeroContent()      Shared hero section (pct, sizes, bar)
  |     +-- buildHintBanner()       Conditional "try Web preset" banner
  |     +-- buildDisclosureSections()  Combined stats+inspector, preview, debug
  |
  +-- ui/compare.js
  |     +-- buildCompareSection()   <details> with lazy PDF-A-go-go viewer
  |     +-- destroyAllComparisons() Cleanup viewers + blob URLs
  |
  +-- ui/stats.js
  |     +-- buildStatsDetail()      Pass-level stats list
  |     +-- buildDebugPanel()       Debug tables (timings, skip reasons)
  |
  +-- ui/inspector.js
  |     +-- buildInspectPanel()     Object breakdown grid (before/after/saved)
  |
  +-- ui/options.js
  |     +-- collectOptions()        Read UI state -> options object
  |     +-- applyPreset()           Apply a named preset to all controls
  |     +-- syncPresetIndicator()   Highlight matching preset button
  |     +-- getCurrentPresetLabel() "Lossless" / "Web" / "Print" / "Custom"
  |     +-- initOptionsListeners()  Wire up event handlers
  |
  +-- ui/helpers.js
        +-- formatSize()            Bytes -> human-readable string
        +-- escapeHtml()            Sanitize for innerHTML
```

---

## Toast / Transient UI

| Element | Trigger | Duration | Notes |
|---------|---------|----------|-------|
| `.toast` | Non-PDF files dropped | 4s + 300ms fade | Fixed bottom-center |
| `.debug-banner` | `?debug` URL param | Persistent | Top of `.app-window` |
| `.drop-overlay` | Files dragged over page | While dragging | Full-page, pointer-events: none |
| `.stale-pulse` animation | Settings changed after results | 1x 2s pulse | On Re-optimize button |
| `.results-settings--stale` | Settings changed after results | Until re-optimize | Etched border + primary outline on settings bar |
| Count-up animation | Results displayed | 600ms ease-out | On savings percentage |
| Bar fill animation | Results displayed | 400ms ease | CSS transition on width |

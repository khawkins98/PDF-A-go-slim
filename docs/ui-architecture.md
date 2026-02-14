# UI Architecture & Information Architecture

Reference diagram for the PDF-A-go-slim interface. Documents the state machine, screen layouts, component hierarchy, and data flow.

---

## State Machine

The app has three mutually exclusive states managed by `showState()` in `main.js`. The `#options-panel` DOM node physically relocates between states.

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

---

## Screen Layouts

### IDLE

```
+========================================================+
|                    PDF-A-go-slim                        |
|       Optimize PDFs in your browser. Files never       |
|       leave your device.                               |
+========================================================+

+--------------------------------------------------------+
|                                                        |
|                    [PDF icon]                           |
|                                                        |
|                  Drop PDFs here                        |
|               or click to select files                 |
|           or [try an example PDF]                      |
|                                                        |
+--------------------------------------------------------+

+-- #options-idle-slot ----------------------------------+
| #options-panel                                         |
|                                                        |
| Preset: [Lossless*] [Web] [Print]                     |
|                                                        |
| > Advanced Settings                                    |
|   +--------------------------------------------------+ |
|   | Mode: [Lossless*|Lossy]                          | |
|   | Image quality: [===|=====] 85  (lossy only)      | |
|   | Max image DPI: [150]           (lossy only)      | |
|   | [x] Unembed standard fonts                       | |
|   | [x] Subset embedded fonts                        | |
|   +--------------------------------------------------+ |
+--------------------------------------------------------+

+-- footer ----------------------------------------------+
|  Built with pdf-lib ... | Debug mode                   |
+--------------------------------------------------------+
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
+========================================================+
|                    PDF-A-go-slim                        |
+========================================================+

+-- #processing -----------------------------------------+
|                                                        |
|  Optimizing...                                         |
|                                                        |
|  +-- file-item -------------------------------------+  |
|  | report.pdf                                       |  |
|  | Optimizing images...                             |  |
|  | [========|============] (shimmer animation)      |  |
|  +--------------------------------------------------+  |
|                                                        |
|  +-- file-item (error) -----------------------------+  |
|  | secret.pdf                                       |  |
|  | This PDF is password-protected  [Retry]          |  |
|  | [######################################] (red)   |  |
|  +--------------------------------------------------+  |
|                                                        |
|                     Cancel                             |
|                                                        |
+--------------------------------------------------------+
```

**Interactions:**
- Progress bar animates per-pass (`PASS_LABELS` maps internal names to friendly labels)
- Cancel -> terminates worker, returns to IDLE
- Error -> shows friendly message + Retry button per file
- Minimum 800ms display time before transitioning to RESULTS

---

### RESULTS: Single File (90% case)

```
+========================================================+
|                    PDF-A-go-slim                        |
+========================================================+

+-- .result-card ----------------------------------------+
|                                                        |
|  .result-card__hero                                    |
|                   -32.4%        (count-up animation)   |
|              1.2 MB -> 840 KB                          |
|              [========        ] (animated bar)         |
|                                                        |
|              [ Download ]                              |
|                                                        |
|              report.pdf                                |
|                                                        |
|  +-- .hint-banner (conditional) --------------------+  |
|  | Images make up 73% of this file.                 |  |
|  | Try the [Web preset] for better compression.     |  |
|  +--------------------------------------------------+  |
|                                                        |
|  > What was optimized           <details/summary>      |
|    +------------------------------------------------+  |
|    | 14 streams recompressed, 3 images recompressed |  |
|    | 2 fonts subsetted, 1 standard font unembedded  |  |
|    |                                                |  |
|    |        Before   After   Saved                  |  |
|    | Fonts  240 KB   80 KB   -160 KB                |  |
|    | Images 800 KB   600 KB  -200 KB                |  |
|    | ...                                            |  |
|    +------------------------------------------------+  |
|                                                        |
|  > Preview                      <details/summary>      |
|    +------------------------------------------------+  |
|    | Optimized -- 840 KB    Powered by PDF-A-go-go  |  |
|    | +--------------------------------------------+ |  |
|    | |                                            | |  |
|    | |          [PDF viewer iframe]               | |  |
|    | |                                            | |  |
|    | +--------------------------------------------+ |  |
|    +------------------------------------------------+  |
|                                                        |
|  > Debug info        (?debug only) <details/summary>   |
|    +------------------------------------------------+  |
|    | Pass timings, skip reasons, converted images   |  |
|    +------------------------------------------------+  |
|                                                        |
+--------------------------------------------------------+

+-- .results-settings -----------------------------------+
|  Settings: **Lossless**         [Change settings]      |
|  +-- .results-settings__body (hidden by default) ----+ |
|  | #options-panel (relocated from idle slot)         | |
|  | Preset: [Lossless*] [Web] [Print]                 | |
|  | > Advanced Settings                               | |
|  +---------------------------------------------------+ |
+--------------------------------------------------------+

         [ Re-optimize ]    [ Start Over ]
```

**Information hierarchy (top to bottom):**
1. "Did it work?" -- savings percentage + sizes (always visible, prominent)
2. "Get my file" -- download button (one clear location)
3. "What happened?" -- hint banner + pass summary + object breakdown (visible but secondary)
4. "Deep dive" -- preview (auto-open for single file, collapsed for batch), debug (collapsed by default)
5. "What next?" -- settings bar + action buttons

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
+========================================================+
|                    PDF-A-go-slim                        |
+========================================================+

+-- .result-card.result-card--summary -------------------+
|                                                        |
|                   -28.7%        (count-up animation)   |
|         4.1 MB -> 2.9 MB across 3 files               |
|         [==========          ] (animated bar)          |
|                                                        |
|              [ Download All ]                          |
|                                                        |
+--------------------------------------------------------+

+-- .result-file-card -----------------------------------+
| report.pdf              1.2 MB -> 840 KB  -32.4%      |
| [ Download ]                                           |
|                                                        |
|  > What was optimized                                  |
|  > Preview                                             |
+--------------------------------------------------------+

+-- .result-file-card -----------------------------------+
| slides.pdf              1.8 MB -> 1.3 MB  -27.8%      |
| [ Download ]                                           |
|                                                        |
|  > What was optimized                                  |
|  > Preview                                             |
+--------------------------------------------------------+

+-- .result-file-card -----------------------------------+
| brochure.pdf            1.1 MB -> 810 KB  -26.2%      |
| [ Download ]                                           |
| [hint banner, if applicable]                           |
|                                                        |
|  > What was optimized                                  |
|  > Preview                                             |
+--------------------------------------------------------+

+-- .results-settings -----------------------------------+
|  Settings: **Lossless**         [Change settings]      |
+--------------------------------------------------------+

         [ Re-optimize ]    [ Start Over ]
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
  +-- header (static)
  +-- #drop-overlay (conditional, z-index: 999)
  |
  +-- #app
  |     |
  |     +-- #drop-zone  [IDLE state]
  |     |     +-- .drop-area (click/drop target)
  |     |           +-- .drop-area__content (icon, text, example button)
  |     |           +-- #file-input (hidden)
  |     |
  |     +-- #options-idle-slot  [IDLE state]
  |     |     +-- #options-panel  <-- physically moves between here and results
  |     |           +-- .presets (Lossless / Web / Print buttons)
  |     |           +-- .advanced (<details>)
  |     |                 +-- .advanced__body (mode, quality, DPI, checkboxes)
  |     |
  |     +-- #processing  [PROCESSING state]
  |     |     +-- h2 "Optimizing..."
  |     |     +-- #file-list (dynamic <li> per file)
  |     |     |     +-- .file-item
  |     |     |           +-- .file-item__name
  |     |     |           +-- .file-item__pass (or __error + __retry)
  |     |     |           +-- .file-item__bar > .file-item__fill
  |     |     +-- .processing-actions > #btn-cancel
  |     |
  |     +-- #results  [RESULTS state]
  |           +-- #results-summary
  |           |     +-- .result-card  (single file)
  |           |     |     +-- .result-card__hero (pct, sizes, bar)
  |           |     |     +-- .result-card__download (<a>)
  |           |     |     +-- .result-card__filename
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
  |           |     +-- .result-file-card  (per file)
  |           |           +-- .result-file-card__header (name + sizes + pct)
  |           |           +-- .result-file-card__download (<a>)
  |           |           +-- .hint-banner (conditional)
  |           |           +-- <details> "What was optimized" (pass stats + inspector)
  |           |           +-- <details> "Preview"
  |           |           +-- <details> "Debug info" (?debug only)
  |           |
  |           +-- #results-settings
  |           |     +-- .results-settings__summary
  |           |     |     +-- "Settings: **Lossless**"
  |           |     |     +-- [Change settings] button
  |           |     +-- .results-settings__body (hidden, expandable)
  |           |           +-- #options-panel  <-- relocated here from idle slot
  |           |
  |           +-- .results-actions
  |                 +-- #btn-reoptimize
  |                 +-- #btn-start-over
  |
  +-- footer (static)
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

## Module Map

```
main.js
  +-- showState()              State machine, DOM visibility, options relocation
  +-- handleFiles()            Main flow: filter PDFs, run workers, render results
  +-- renderResults()          Delegates to result-card.js builders
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
| `.debug-banner` | `?debug` URL param | Persistent | Top of `<body>` |
| `.drop-overlay` | Files dragged over page | While dragging | Full-page, pointer-events: none |
| `.stale-pulse` animation | Settings changed after results | 1x 2s pulse | On Re-optimize button |
| `.results-settings--stale` | Settings changed after results | Until re-optimize | Blue border on settings bar |
| Count-up animation | Results displayed | 600ms ease-out | On savings percentage |
| Bar fill animation | Results displayed | 400ms ease | CSS transition on width |

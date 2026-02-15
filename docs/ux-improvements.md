# UX/UI Improvements

Prioritized backlog of visual polish, usability, and accessibility improvements. Benchmarked against Squoosh, TinyPNG, iLovePDF, and Smallpdf.

## Quick wins (low effort)

- [x] **Full-page drop overlay** — Listen for drag on `document.body`, show a full-viewport overlay with "Drop to optimize" message. Currently drops outside the drop zone are silently ignored. Filter with `e.dataTransfer.types.includes('Files')`.

- [x] **Graceful error states** — When processing fails, add an inline "Retry" button on the failed file item. If all files fail, show an error state with "Try again" / "Choose different files" instead of an empty results table. Map common errors to user-friendly text (e.g. "Password-protected PDFs are not supported"). Add a "Start Over" escape hatch visible during processing.

- [x] **Hero card count-up animation** — The bar's `transition: width 0.4s` never fires because width is set at creation time. Fix by setting width to 0% initially, then updating on next frame. Animate the percentage counting up from 0 with `requestAnimationFrame`.

- [x] **Non-PDF file rejection feedback** — `handleFiles` silently returns when no PDFs are found. Show a brief inline message: "Only PDF files are supported. N files were skipped."

- [x] **Personality pass on empty states** — Replace generic placeholder text with copy that has character: "Nothing to report yet", "Waiting for a PDF to dissect", "No document loaded". Status bar: "Ready — files never leave your device".

- [x] **Richer zero-savings message** — Status bar now shows "Done — already well-optimized" instead of "Done — no size reduction."

- [x] **Focus indicator consistency** — The drop area sets `outline: none` on `:focus-visible` (WCAG failure). Replace with a custom focus ring (`outline: 2px solid var(--color-primary); outline-offset: 2px`). Add `:focus-visible` styles to `.btn`, `.preset-btn`, `.mode-btn`.

- [x] **Preset discoverability** — Bump `.preset-btn__desc` from `0.65rem` to `0.72rem`. Add a gear icon to the "Advanced Settings" toggle. Consider a counter badge ("2 options customized").

## Medium effort

- [ ] **Mobile responsiveness** — Results table (5 columns) and inspect panel (5-column grid) overflow on small screens. At `max-width: 640px`: convert results to card layout, collapse inspect grid to 2-3 columns, add `flex-wrap: wrap` to preset buttons, ensure 44px minimum tap targets.

- [x] **Dark mode** — Manual toggle in Appearance palette. Overrides all CSS custom properties. Amber, Ocean, and Forest color scheme themes also included. CRT scanline overlay option.

- [ ] **Accessibility ARIA** — Add `aria-live="polite"` to processing section for screen reader progress announcements. Move focus to hero card/download button after results render. Add `aria-pressed` to preset and mode toggle buttons. Add `aria-expanded` to collapsible toggles. Add `aria-valuetext` to quality slider.

- [x] **Processing feedback polish** — Map internal pass names to user-friendly labels (e.g. "Subsetting fonts" -> "Optimizing fonts..."). Add a shimmer/pulse CSS animation on the progress bar fill while active. For files >5 MB, show estimated remaining time. Show percentage text next to the bar.

- [x] **Large file warning + cancel** — For files >50 MB, show a warning about processing time. For >200 MB, recommend a desktop tool. Add a "Cancel" button during processing that calls `worker.terminate()`.

- [x] **Themed transient UI** — Toast restyled as Platinum alert box (cream bg, border, ⚠ prefix). Drop overlay restyled as centered Platinum dialog over dimmed desktop (no blur, no dashed border).

- [x] **Surface PDF metadata** — Inspector palette now shows a compact metadata header (pages, producer, PDF/A level, tagged status) above pass stats. `stats.documentInfo` collected from pdf-lib in pipeline.

- [x] **Credits/colophon dialog** — "About" button in status bar opens a Platinum-styled modal with app name, description, tech stack credits, and GitHub link. Closes on OK/Escape/overlay click.

- [x] **Batch progress indicator** — For multi-file uploads, add a header: "Optimizing file 2 of 5..." with an overall progress bar above the per-file list.

- [x] **Control Strip** — Mac OS 8-style collapsible toolbar at bottom-left with preset quick-switch, GitHub link, and About button. Collapses via grab tab. Full-width on mobile.

- [x] **Desktop icons** — Read Me and GitHub icons on the desktop surface (bottom-right). Read Me opens a Stickies-style palette with the project README rendered as HTML. GitHub opens the repo in a new tab.

- [x] **Sample PDF desktop icons** — Three draggable sample PDF icons (Research Paper, TAM Review, Color Graphics) on the desktop. Users can drag them onto the drop zone or click to fetch + optimize. Uses `application/x-pdf-sample` custom dataTransfer type to distinguish from native file drags. Loading state shown while fetching. Hidden on mobile (<768px) with existing desktop-icons rule.

- [x] **Read Me palette (Stickies)** — Yellow Mac Stickies-style floating palette displaying the project README.md content, rendered via a minimal markdown-to-HTML function. Scrollable, draggable, shadable.

## Bugs

- [x] **calrgb.pdf loses all background colors and text after optimization** — **Fixed.** Root cause: fflate's `deflateSync` produces raw DEFLATE without the 2-byte zlib header (RFC 1950), but PDF's FlateDecode spec expects zlib-wrapped data. macOS Preview and other PDF viewers silently fail on headerless deflate, rendering blank pages. This affected all stream recompression and font subsetting output. Fix: replaced `deflateSync` with `zlibSync` in `streams.js` and `font-subset.js`. Also hardened the BFS traversal (`PDFRawStream` → `PDFStream` base class) and added a `checkContentIntegrity()` post-pipeline guard.

## Lower priority

- [ ] **Drop zone micro-interactions** — Brief scale animation (`transform: scale(1.02)`) on successful file selection. Subtle box-shadow glow pulse on drag-over. Animate the SVG upload icon during drag.

- [ ] **Single-file results consolidation** — For the most common case (one file), hide the table entirely and consolidate everything into the hero card: move "Show details" and "Object breakdown" toggles into the hero section.

- [ ] **Typography scale consolidation** — Currently 9+ different font sizes from `0.65rem` to `2rem`. Consolidate to a 5-step scale defined as CSS custom properties (`--text-xs` through `--text-xl`). Bump inspector minimum from `0.72rem` to `0.75rem`.

- [ ] **Sound effects for key moments** — Optional audio cues for optimization complete, error, drag-over (off by default, respect `prefers-reduced-motion`). PostHog uses sound effects throughout; we'd keep it minimal and opt-in.

- [ ] **Keyboard shortcuts overlay** — `?shortcuts` URL param showing available shortcuts in a Platinum-styled window. Builds on the `?debug` pattern we already have.

## Easter eggs

Small, discoverable surprises that reinforce the retro aesthetic. Each should be under a day to implement. All animated items must respect `prefers-reduced-motion`. State (unlocked themes, dismissed alerts) persists via `localStorage`.

### Audio

- [x] **Startup chime** — Easter egg toggle stub in Appearance palette. Checks localStorage + prefers-reduced-motion, logs to console. Full Web Audio implementation deferred.

### Visual

- [ ] **Classic bomb error dialog** — On unexpected processing error, show a Platinum-styled alert with the Mac bomb icon (inline SVG pixel art, ~20x20), "Sorry, a system error occurred", a hex error code derived from the actual error, and a "Restart" button that reloads. Replaces the generic error toast for unhandled exceptions only.

- [ ] **Screensaver idle mode** — After 5 minutes of inactivity, overlay a CSS-only animation (flying toasters via `@keyframes` translate + sprite rotation, or a starfield using radial-gradient particles). Click or keypress dismisses. Use `requestAnimationFrame` sparingly; respect `prefers-reduced-motion` by showing a static "screen saver" label instead.

- [ ] **Spinning beach ball** — Show a rainbow beach ball (CSS conic-gradient + rotate animation) for the first 300ms of processing. Brief enough to be a wink, not an annoyance. Replaces the progress bar only during the initial delay.

- [x] **Happy Mac on big savings** — Easter egg toggle stub in Appearance palette. Triggered when savings >= 30%. Full pixel-art SVG implementation deferred.

- [x] **Sad Mac on zero savings** — Easter egg toggle stub in Appearance palette. Triggered when savings <= 0%. Full pixel-art SVG implementation deferred.

- [ ] **Finder zoom-rect open** — Classic Mac "zoom rectangle" animation when opening/restoring palettes. Four concentric rectangles scaling from source to destination over ~200ms using CSS `@keyframes`. Respect `prefers-reduced-motion`.

- [ ] **Trash can for rejected files** — When a non-PDF file is dragged over the drop zone, show an animated trash can icon (CSS lid-open transform on dragenter, lid-close on dragleave). Reinforces the "PDFs only" constraint with personality.

- [x] **Desktop pattern chooser** — Appearance palette with 9 pattern swatches (solid, tartan, bricks, diagonal, dots, checkerboard, weave, zigzag, denim). Selection stored in `localStorage`.

### Interactive

- [ ] **"About This Mac" system info** — Expand the existing About dialog with a "More Info..." button that reveals: browser name/version (from `navigator.userAgent`), OS, `navigator.deviceMemory`, pdf-lib version (from `package.json` at build time), harfbuzzjs WASM status (loaded/not loaded), and session stats (files processed, total bytes saved). Styled as a classic Mac system profiler panel.

- [ ] **Konami code theme** — Listen for `up up down down left right left right b a` keystrokes. On match, unlock a hidden theme: CRT scanlines (CSS `repeating-linear-gradient` overlay), amber terminal palette, or hot-dog-stand colors. Theme stored in `localStorage`, togglable back to default. Show a brief "Theme unlocked" alert in Platinum style.

- [ ] **"Get Info" on results** — Right-click (or long-press on mobile) a result card to open a classic Mac "Get Info" window showing detailed PDF metadata: producer, creator, creation date, page count, embedded fonts list, image count, and file permissions. Implemented as a small floating palette.

- [ ] **Balloon Help tooltips** — `?balloons` URL param enables classic Mac Balloon Help. Hover any UI element to see a yellow, rounded-rectangle tooltip with a pointer stem (CSS `clip-path` or border-triangle). Cursor changes to the question-mark pointer (`cursor: help`). Balloon content defined via `data-balloon` attributes.

- [ ] **"Not Enough Memory" dialog** — When a file exceeds 50MB, show a classic Mac low-memory dialog ("There is not enough memory to complete this operation") before proceeding. Purely cosmetic — processing continues after the user clicks OK. Replaces the existing large-file warning with themed equivalent.

- [ ] **Extension conflict alert** — On first visit (check `localStorage`), show a joke System 7-style alert: "PDF-A-go-slim would like to optimize your PDFs" with an "OK" button only (no "Cancel"). Sets a `localStorage` flag so it appears only once.

### Meta

- [ ] **System version tooltip** — Click the app name in the title bar to see "PDF-A-go-slim v1.0 / Built [date] / pdf-lib [version]". Build date and version injected at build time via Vite `define`. Tooltip implemented as a small absolutely-positioned Platinum panel.

- [ ] **"Rebuild Desktop" progress bar** — Accessible via `?rebuild` URL param or a hidden button in the About dialog. Shows a mock "Rebuilding Desktop..." progress bar that fills over 5 seconds, then dismisses with "Desktop rebuilt successfully." Pure CSS animation, no actual operation.

- [ ] **Keyboard shortcuts overlay** (from Lower priority above) — `?shortcuts` URL param showing available shortcuts in a Platinum-styled window. Builds on the `?debug` and `?balloons` pattern.

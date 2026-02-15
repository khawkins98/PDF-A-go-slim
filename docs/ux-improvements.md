# UX/UI Improvements

Prioritized backlog of visual polish, usability, and accessibility improvements. Benchmarked against Squoosh, TinyPNG, iLovePDF, and Smallpdf.

## Quick wins (low effort)

- [ ] **Full-page drop overlay** — Listen for drag on `document.body`, show a full-viewport overlay with "Drop to optimize" message. Currently drops outside the drop zone are silently ignored. Filter with `e.dataTransfer.types.includes('Files')`.

- [ ] **Graceful error states** — When processing fails, add an inline "Retry" button on the failed file item. If all files fail, show an error state with "Try again" / "Choose different files" instead of an empty results table. Map common errors to user-friendly text (e.g. "Password-protected PDFs are not supported"). Add a "Start Over" escape hatch visible during processing.

- [ ] **Hero card count-up animation** — The bar's `transition: width 0.4s` never fires because width is set at creation time. Fix by setting width to 0% initially, then updating on next frame. Animate the percentage counting up from 0 with `requestAnimationFrame`.

- [ ] **Non-PDF file rejection feedback** — `handleFiles` silently returns when no PDFs are found. Show a brief inline message: "Only PDF files are supported. N files were skipped."

- [ ] **Personality pass on empty states** — Replace generic placeholder text ("Drop a PDF to see results") with copy that has character. Inspired by PostHog's personality-in-every-surface approach.

- [ ] **Richer zero-savings message** — Explain *why* ("Already well-optimized — every pass found nothing to improve") not just "Done — no size reduction."

- [ ] **Focus indicator consistency** — The drop area sets `outline: none` on `:focus-visible` (WCAG failure). Replace with a custom focus ring (`outline: 2px solid var(--color-primary); outline-offset: 2px`). Add `:focus-visible` styles to `.btn`, `.preset-btn`, `.mode-btn`.

- [ ] **Preset discoverability** — Bump `.preset-btn__desc` from `0.65rem` to `0.72rem`. Add a gear icon to the "Advanced Settings" toggle. Consider a counter badge ("2 options customized").

## Medium effort

- [ ] **Mobile responsiveness** — Results table (5 columns) and inspect panel (5-column grid) overflow on small screens. At `max-width: 640px`: convert results to card layout, collapse inspect grid to 2-3 columns, add `flex-wrap: wrap` to preset buttons, ensure 44px minimum tap targets.

- [ ] **Dark mode** — Add `@media (prefers-color-scheme: dark)` block overriding CSS custom properties. The variable architecture is already in place. Needs WCAG AA contrast checking on every color pairing. Consider a manual sun/moon toggle in the header.

- [ ] **Accessibility ARIA** — Add `aria-live="polite"` to processing section for screen reader progress announcements. Move focus to hero card/download button after results render. Add `aria-pressed` to preset and mode toggle buttons. Add `aria-expanded` to collapsible toggles. Add `aria-valuetext` to quality slider.

- [ ] **Processing feedback polish** — Map internal pass names to user-friendly labels (e.g. "Subsetting fonts" -> "Optimizing fonts..."). Add a shimmer/pulse CSS animation on the progress bar fill while active. For files >5 MB, show estimated remaining time. Show percentage text next to the bar.

- [ ] **Large file warning + cancel** — For files >50 MB, show a warning about processing time. For >200 MB, recommend a desktop tool. Add a "Cancel" button during processing that calls `worker.terminate()`.

- [ ] **Themed transient UI** — Apply Platinum vocabulary to `.toast` (alert box style) and `.drop-overlay` (dialog pattern). PostHog wraps every surface in OS chrome; we should do the same for transient elements.

- [ ] **Surface PDF metadata** — Show page count, producer, PDF/A level in Inspector header. Data already available in `stats.pdfTraits` — just surface it. Inspired by PostHog's transparency-as-UX: show users the "why" behind optimization decisions.

- [ ] **Credits/colophon dialog** — "About" link in status bar opening a Platinum-styled dialog with version, tech stack, and attributions. Small easter egg opportunity.

- [ ] **Batch progress indicator** — For multi-file uploads, add a header: "Optimizing file 2 of 5..." with an overall progress bar above the per-file list.

## Lower priority

- [ ] **Drop zone micro-interactions** — Brief scale animation (`transform: scale(1.02)`) on successful file selection. Subtle box-shadow glow pulse on drag-over. Animate the SVG upload icon during drag.

- [ ] **Single-file results consolidation** — For the most common case (one file), hide the table entirely and consolidate everything into the hero card: move "Show details" and "Object breakdown" toggles into the hero section.

- [ ] **Typography scale consolidation** — Currently 9+ different font sizes from `0.65rem` to `2rem`. Consolidate to a 5-step scale defined as CSS custom properties (`--text-xs` through `--text-xl`). Bump inspector minimum from `0.72rem` to `0.75rem`.

- [ ] **Sound effects for key moments** — Optional audio cues for optimization complete, error, drag-over (off by default, respect `prefers-reduced-motion`). PostHog uses sound effects throughout; we'd keep it minimal and opt-in.

- [ ] **Keyboard shortcuts overlay** — `?shortcuts` URL param showing available shortcuts in a Platinum-styled window. Builds on the `?debug` pattern we already have.

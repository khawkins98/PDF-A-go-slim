# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PDF-A-go-slim is a browser-based PDF optimization tool that reduces file size entirely client-side (no server uploads). Built with Vite, using pdf-lib for PDF manipulation, fflate for compression, jpeg-js for image recompression, and harfbuzzjs for font subsetting.

## Commands

- `npm run dev` — start Vite dev server (http://localhost:5173)
- `npm run build` — production build
- `npm test` — run all tests once (`vitest run`) + regenerate benchmark report
- `npm run test:watch` — run tests in watch mode
- `npm run benchmark` — regenerate `docs/benchmark-results.md` only
- Single test file: `npx vitest run test/engine/dedup.test.js`

## Architecture

```
index.html → src/main.js (UI state machine, drag-and-drop, worker orchestration)
                 ↓
             src/worker.js (Web Worker — off-main-thread processing)
                 ↓
             src/engine/pipeline.js (sequential optimization passes with progress)
                 ↓
             src/engine/inspect.js (object classification — before/after snapshots)
                 ↓
             src/engine/optimize/  (passes, run in order):
               streams.js      — recompress streams with fflate level 9
               images.js       — JPEG recompression + DPI downsampling
               font-unembed.js — remove standard 14 font embeddings
               font-subset.js  — subset embedded fonts via harfbuzzjs WASM
               dedup.js        — hash-based object deduplication (djb2)
               fonts.js        — consolidate duplicate embedded fonts
               metadata.js     — strip XMP, Illustrator, Photoshop bloat keys
               unreferenced.js — remove unreachable objects via BFS traversal
                 ↓
             src/engine/utils/
               stream-decode.js          — decoders: Flate, LZW, ASCII85, ASCIIHex, RunLength
               pdf-traversal.js          — BFS graph walker from PDF trailer
               content-stream-parser.js  — extract char codes per font from content streams
               unicode-mapper.js         — map char codes → Unicode codepoints
               glyph-list.js             — Adobe Glyph List + encoding tables
               harfbuzz-subsetter.js     — harfbuzzjs WASM wrapper for font subsetting
               accessibility-detect.js   — PDF/A, PDF/UA, tagged PDF detection
               hash.js                   — shared djb2 hash + FONT_FILE_KEYS constant

             src/ui/  (UI modules, imported by main.js):
               palette.js      — createPalette(), initWindowManager(), initDrag(), bringToFront(), isMobile() (floating window manager)
               result-card.js  — buildSingleFileCard(), buildSummaryCard(), buildFileTableHeader(), buildFileCard(), buildResultsPaletteContent(), buildInspectorPaletteContent()
               compare.js      — buildCompareSection(), buildPreviewContent() (direct-render for Preview palette), destroyAllComparisons()
               stats.js        — buildStatsDetail(), buildDebugPanel(), formatPassStats()
               inspector.js    — buildInspectPanel() (object breakdown grid), initInspectorInteractions() ("Show more" delegation)
               options.js      — collectOptions(), applyPreset(), syncPresetIndicator(), getCurrentPresetLabel(), initOptionsListeners()
               control-strip.js — createControlStrip() (Mac OS 8 Control Strip toolbar)
               appearance.js   — buildAppearanceContent(), initAppearance(), playStartupChime(), showHappyMac(), showSadMac() (desktop patterns, themes, easter egg toggles)
               helpers.js      — formatSize(), escapeHtml(), renderMarkdown()

scripts/
  benchmark-report.js     — generates docs/benchmark-results.md from reference PDFs

test/
  fixtures/
    create-test-pdfs.js          — unit-test PDF factories (return PDFDocument)
    create-benchmark-pdfs.js     — benchmark PDF generators (return Uint8Array)
  utils/
    pdf-verify.js                — verification helpers for inspecting optimized PDFs
  engine/
    benchmark.test.js            — 46 benchmark tests (compression, accessibility, PDF/A)
    ...                          — per-pass unit tests mirroring src/engine/
```

### Key design decisions

- **Web Worker boundary:** `main.js` sends an `ArrayBuffer` to `worker.js` (transferred, not copied); the worker calls the pipeline and posts progress/results back. UI never touches pdf-lib directly. Worker message protocol: inbound `{ type: 'optimize', buffer, options }`, outbound `{ type: 'progress' | 'result' | 'error', ... }`.
- **Floating palette desktop:** Main window has persistent drop zone (always visible, dimmed during processing). Four floating palettes (Settings, Results, Inspector, Preview) are always on screen — empty state placeholder until optimization completes. Palettes are draggable by title bar, shadable (double-click title bar collapses to title bar only), and have z-index management via `bringToFront()`. Mobile (<768px) stacks palettes vertically with no dragging.
- **Sample PDF icons:** Desktop icons for 3 sample PDFs (tracemonkey, TAMReview, calrgb) from pdf.js test suite. Draggable onto drop zone via custom `application/x-pdf-sample` dataTransfer type, or clickable to fetch + optimize directly. Uses shared `fetchPdfAsFile()` helper. The inline "try an example" button also uses this helper.
- **Size guard:** The pipeline never returns an optimized PDF larger than the input — it falls back to the original bytes.
- **Image filters preserved:** JPEG, JPEG2000, CCITT, and JBIG2 streams are intentionally skipped (already optimal).
- **All optimization passes** receive the same `(pdfDoc, options)` signature and mutate the PDFDocument in place. The pipeline `await`s each pass (font-subset is async due to WASM).
- **Options/presets:** `collectOptions()` reads UI state → options object. Three presets (lossless/web/print) map to option combinations. `syncPresetIndicator()` highlights the matching preset when manual settings change.
- **Utils layer discipline:** If more than one optimization pass needs a function, it belongs in `utils/`. Passes should not import from each other.
- **Options panel:** `#options-panel` lives in HTML (so `options.js` module-level querySelectorAll finds elements on import), then physically moved into the Settings palette body on init. Event listeners survive DOM relocation.
- **Stale results detection:** After results render, changing any option triggers `checkStaleResults()` which compares current options JSON vs last-run options. Adds `.btn--stale` to Re-optimize button inside the Settings palette. Re-optimize re-runs `handleFiles(lastFiles)` with current options.
- **Debug mode:** Add `?debug` to the URL. Shows a persistent banner, per-pass timing, image skip reason breakdowns, and per-image conversion details in a collapsible "Debug info" section. Pass stats objects can include a `_debug` field with additional diagnostics.
- **Minimum processing display time:** 800ms before transitioning to results, preventing jarring flashes on fast files.

### Dependencies

- **pdf-lib** — low-level PDF object access (PDFDocument, PDFDict, PDFArray, PDFRawStream, etc.)
- **fflate** — pure-JS zlib for deflateSync/inflateSync in the browser
- **jpeg-js** — pure-JS JPEG encoder/decoder (works in Web Workers and Node)
- **harfbuzzjs** — WASM font subsetting engine (lazy-loaded, separate chunk)

## Testing

Tests are in `test/engine/` and mirror the `src/engine/` structure. Unit tests create PDF fixtures inline using pdf-lib via `test/fixtures/create-test-pdfs.js`. Benchmark tests use more complex reference PDFs from `test/fixtures/create-benchmark-pdfs.js` that return saved bytes (not PDFDocument) and combine multiple bloat vectors per fixture.

### Build & test config

- **Vite:** `build.target: 'es2020'`, `worker.format: 'es'` (ES modules for Web Workers)
- **Vitest:** `test.environment: 'node'` (not jsdom — no DOM APIs in tests)

### Key testing patterns

- **Save/reload cycle:** pdf-lib creates font objects lazily — they don't exist in `context` until `save()` is called. Tests that manipulate fonts must: `await doc.save()` → `await PDFDocument.load(savedBytes)` → then assert.
- **Image test data:** Use smooth sine-wave patterns (`Math.sin(x * freq)`), never `Math.random()`. Random noise has high entropy that deflates poorly but *also* compresses poorly as JPEG, causing the size guard to skip the image and making the test meaningless.
- **PDF number extraction:** Use `Number(val.toString())` for reliable numeric reads from pdf-lib dicts. The `.numberValue()` / `.value()` accessors are inconsistent depending on how the number was created.
- **Benchmark test pattern:** Run `optimize()` once in `beforeAll`, store `output`/`stats`/`outputDoc`, then assert many properties in separate `it()` blocks. Avoids re-running the full 8-pass pipeline per assertion.
- **Verification utilities (`test/utils/pdf-verify.js`):** `getEmbeddedFonts()`, `getMetadataStatus()`, `getStructureTreeInfo()`, `getDocumentGeometry()`, `getImageInfo()` — use these to inspect optimized PDFs rather than manually traversing pdf-lib objects.

### Known library gotchas

- **harfbuzzjs CJS/ESM interop:** Don't `import('harfbuzzjs')` — its `module.exports = Promise` causes ESM thenable breakage in Vitest. Load the WASM binary directly via `WebAssembly.instantiate()`.
- **fflate vs pako:** pdf-lib uses pako internally. fflate's `inflateSync` can fail on some pako-produced streams; use `decompressSync` as fallback.
- **Node.js 18+ global fetch:** Use `process.versions?.node` check for environment detection, not `typeof fetch`.

## Reference

- `docs/learnings.md` — detailed technical notes on PDF internals, font subsetting, image recompression, and object classification
- `docs/benchmark-results.md` — auto-generated benchmark report (regenerated by `npm test`)
- `docs/ui-architecture.md` — state machine, screen layouts, component hierarchy, data flow
- `docs/ux-improvements.md` — prioritized backlog of UI/UX improvements
- `PRD.md` — product requirements document

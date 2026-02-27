# CLAUDE.md

PDF-A-go-slim is a browser-based PDF optimization tool (Vite + pdf-lib + fflate + jpeg-js + harfbuzzjs). All processing is client-side in a Web Worker.

## Commands

- `npm run dev` — dev server
- `npm run build` — production build
- `npm test` — tests + benchmark report
- Single test: `npx vitest run test/engine/dedup.test.js`

## Gotchas

### Library traps

- **harfbuzzjs CJS/ESM interop:** Don't `import('harfbuzzjs')` — its `module.exports = Promise` causes ESM thenable breakage in Vitest. Load the WASM binary directly via `WebAssembly.instantiate()`.
- **fflate: use `zlibSync`, NOT `deflateSync`:** `deflateSync` produces raw DEFLATE without zlib header. PDF's FlateDecode expects zlib-wrapped data (0x78... header). macOS Preview silently renders blank pages with raw DEFLATE.
- **fflate decompression: use `decompressSync` first, NOT `inflateSync`:** `inflateSync` is raw DEFLATE only. With certain zlib headers (e.g., `0x48 0x89` from ReportLab), it silently returns truncated data instead of throwing. Always use `decompressSync` (auto-detects zlib/gzip/raw) as the primary decompressor, with `inflateSync` as fallback.
- **`PDFStream` does NOT extend `PDFDict`:** `PDFStream` has a `.dict` property; use `obj.dict.get()` for streams. Only `PDFDict` subclasses have `.get()` directly. BFS traversal should use `instanceof PDFStream` (base class), not `PDFRawStream`.
- **PDF number extraction:** Use `Number(val.toString())` for reliable numeric reads from pdf-lib dicts. The `.numberValue()` / `.value()` accessors are inconsistent depending on how the number was created.

### Font subsetting correctness guards

Two guards in `font-subset.js` are **not configurable** — they prevent broken output:
1. Cmap-less CIDFontType2 fonts must use GID-based subsetting (`hb_subset_input_glyph_set`) because harfbuzz's Unicode path needs a cmap table.
2. Already-subsetted simple fonts (`ABCDEF+` prefix) are skipped because their renumbered char codes depend on the embedded cmap.

### Testing traps

- **Save/reload cycle:** pdf-lib creates font objects lazily — they don't exist until `save()`. Tests that check fonts must: `await doc.save()` → `await PDFDocument.load(savedBytes)` → then assert.
- **Image test data:** Use smooth sine-wave patterns (`Math.sin(x * freq)`), never `Math.random()`. Random noise compresses poorly as JPEG, causing the size guard to skip and making the test meaningless.
- **Test environment is Node**, not jsdom — no DOM APIs in tests.

## Conventions

- **Utils layer:** If more than one optimization pass needs a function, it belongs in `src/engine/utils/`. Passes should not import from each other.
- **Options panel DOM trick:** `#options-panel` lives in HTML (so `options.js` module-level querySelectorAll runs on import), then gets physically moved into the Settings palette body. Event listeners survive the relocation.
- **Build-time defines:** `__BUILD_DATE__` and `__APP_VERSION__` are injected by Vite from `vite.config.js`. Used in About and startup warning dialogs.

## Reference

- `docs/learnings.md` — PDF internals, font subsetting, image recompression deep dives
- `docs/ui-architecture.md` — state machine, component hierarchy, data flow
- `docs/ux-improvements.md` — prioritized UI/UX backlog
- `CHANGELOG.md` — notable changes per release
- `PRD.md` — product requirements document

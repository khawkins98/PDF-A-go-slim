# PDF-A-go-slim

A browser-based PDF optimization tool that reduces file size entirely client-side. No uploads, no accounts, no file size limits beyond available RAM.

## Features

- **Drag-and-drop** — drop one or more PDFs, or use the file picker
- **8 optimization passes** — stream recompression, image recompression, standard font unembedding, font subsetting, object deduplication, font deduplication, metadata stripping, unreferenced object removal
- **Optimization presets** — Lossless (default), Web (lossy, 75% quality), Print (lossy, 92% quality)
- **Advanced controls** — lossy/lossless toggle, image quality slider, font unembedding and subsetting checkboxes
- **Per-file stats** — expandable detail rows showing what each pass accomplished
- **Object inspector** — before/after breakdown of every PDF object by category (fonts, images, content streams, metadata, page tree) with per-category savings
- **Privacy-first** — files never leave your browser; all processing runs in a Web Worker
- **Batch capable** — optimize multiple PDFs at once with individual or bulk download

## Quick Start

```bash
npm install
npm run dev
```

Open `http://localhost:5173`, drop a PDF, and download the optimized version.

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server |
| `npm run build` | Production build |
| `npm test` | Run all tests (`vitest run`) |
| `npm run test:watch` | Run tests in watch mode |

## Architecture

```
index.html → src/main.js (UI, drag-and-drop, options panel, worker orchestration)
                 ↓
             src/worker.js (Web Worker — off-main-thread processing)
                 ↓
             src/engine/pipeline.js (sequential optimization passes with progress)
                 ↓
             src/engine/inspect.js (object classification — before/after snapshots)
                 ↓
             src/engine/optimize/  (8 passes, run in order):
               streams.js      — recompress streams with fflate level 9
               images.js       — FlateDecode → JPEG recompression (lossy, opt-in)
               font-unembed.js — remove embedded base-14 standard fonts
               font-subset.js  — subset embedded fonts via harfbuzzjs WASM
               dedup.js        — hash-based object deduplication (djb2)
               fonts.js        — consolidate duplicate embedded fonts
               metadata.js     — strip XMP, Illustrator, Photoshop bloat keys
               unreferenced.js — remove unreachable objects via BFS traversal
```

## Built With

- [pdf-lib](https://github.com/Hopding/pdf-lib) — low-level PDF object access
- [fflate](https://github.com/101arrowz/fflate) — pure-JS zlib compression
- [jpeg-js](https://github.com/jpeg-js/jpeg-js) — pure-JS JPEG encoder
- [harfbuzzjs](https://github.com/nicbou/harfbuzzjs) — WASM font subsetting
- [Vite](https://vitejs.dev/) — build tooling
- [Vitest](https://vitest.dev/) — test runner

## Related

- [PDF-A-go-go](https://github.com/khawkins98/PDF-A-go-go) — embeddable PDF viewer for the web (sibling project)

## License

MIT

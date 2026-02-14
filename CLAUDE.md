# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PDF-A-go-slim is a browser-based PDF optimization tool that reduces file size entirely client-side (no server uploads). Built with Vite, using pdf-lib for PDF manipulation and fflate for compression.

## Commands

- `npm run dev` — start Vite dev server
- `npm run build` — production build
- `npm test` — run all tests once (`vitest run`)
- `npm run test:watch` — run tests in watch mode
- To run a single test file: `npx vitest run test/engine/dedup.test.js`

## Architecture

```
index.html → src/main.js (UI, drag-and-drop, worker orchestration)
                 ↓
             src/worker.js (Web Worker — off-main-thread processing)
                 ↓
             src/engine/pipeline.js (sequential optimization passes with progress reporting)
                 ↓
             src/engine/optimize/  (5 independent passes, run in order):
               streams.js    — recompress streams with fflate level 9
               dedup.js      — hash-based object deduplication (djb2)
               fonts.js      — consolidate duplicate embedded fonts
               metadata.js   — strip XMP, Illustrator, Photoshop bloat keys
               unreferenced.js — remove unreachable objects via BFS traversal
                 ↓
             src/engine/utils/
               stream-decode.js   — decoders: Flate, LZW, ASCII85, ASCIIHex, RunLength
               pdf-traversal.js   — BFS graph walker from PDF trailer
```

### Key design decisions

- **Web Worker boundary:** `main.js` sends an ArrayBuffer to `worker.js`; the worker calls the pipeline and posts progress/results back. UI never touches pdf-lib directly.
- **Size guard:** The pipeline never returns an optimized PDF larger than the input — it falls back to the original bytes.
- **Image filters preserved:** JPEG, JPEG2000, CCITT, and JBIG2 streams are intentionally skipped (already optimal).
- **All optimization passes** receive the same `(pdfDoc, onProgress)` signature and mutate the PDFDocument in place.

### Dependencies

- **pdf-lib** — low-level PDF object access (PDFDocument, PDFDict, PDFArray, PDFRawStream, etc.)
- **fflate** — pure-JS zlib for deflateSync/inflateSync in the browser

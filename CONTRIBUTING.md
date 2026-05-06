# Contributing

Thanks for your interest. PDF-A-go-slim is a browser-based PDF optimizer — all processing runs in a Web Worker on the user's machine, never a server. Contributions that preserve that privacy property are most welcome.

## Filing issues

Open an issue at https://github.com/khawkins98/PDF-A-go-slim/issues. Useful detail:

- A small repro PDF, or a description of how to make one. Don't share PDFs with sensitive content.
- Browser + OS, browser console output if something errored.
- Original size, post-optimize size, and which pass(es) you suspect (stream recompression, image recompression, font subsetting, etc.).
- For "blank pages after optimize" reports, please mention which viewer (browser, Adobe, macOS Preview) — different viewers tolerate different malformations.

## Proposing changes

1. Fork and branch off `main`.
2. `npm install`, `npm run dev`, `npm test`. Tests run in Node (no jsdom, no DOM APIs).
3. Single test: `npx vitest run test/engine/dedup.test.js`.
4. Open a draft PR while you iterate.

## What to watch when editing

The CLAUDE.md file is the canonical list. The most important pitfalls:

- **fflate: `zlibSync` not `deflateSync`** for compression; `decompressSync` not `inflateSync` for decompression. Raw DEFLATE silently produces blank pages in macOS Preview, and `inflateSync` silently returns truncated data on some zlib headers (e.g., `0x48 0x89` from ReportLab).
- **`PDFStream` does not extend `PDFDict`.** Use `obj.dict.get()` for streams.
- **Font-subset guards are non-configurable** — cmap-less CIDFontType2 fonts must use GID-based subsetting; already-subsetted simple fonts (`ABCDEF+` prefix) are skipped. Don't loosen these.
- **harfbuzzjs interop**: load the WASM binary directly via `WebAssembly.instantiate()` — don't `import('harfbuzzjs')`.
- **Test PDFs need a save/reload cycle** before asserting on font objects (pdf-lib creates them lazily).
- **Image test data**: smooth sine-wave patterns, not `Math.random()` (random noise compresses poorly and skips the size guard).
- **Utils-layer rule**: any function used by more than one pass goes into `src/engine/utils/`. Passes don't import from each other.

## Branch and commit style

- Branches: descriptive, e.g. `fix/flatedecode-header`, `feat/pwa-support`.
- Commits: short, imperative; recent history mixes Conventional Commits and plain summaries — match what's nearby.

## Review

Best-effort, no SLA. Bug reports with a small repro PDF are usually fast.

## License

MIT. See [LICENSE](LICENSE).

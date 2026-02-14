# PDF-A-go-slim — Learnings & Technical Notes

Technical knowledge accumulated during development. Updated as we go.

---

## PDF Internals

### How Fonts Are Embedded

PDF fonts come in several flavors, each stored differently:

- **FontFile** (Type 1) — PostScript font programs. Legacy format, rarely seen in modern PDFs.
- **FontFile2** (TrueType) — Glyph outlines as quadratic B-splines in a `glyf` table. Glyph selection by GID (integer index).
- **FontFile3** (CFF/OpenType) — Glyph outlines as cubic Bezier curves. Subtype `CIDFontType0C` for CID-keyed CFF.

A single embedded font can easily be 50 KB–several MB. CJK fonts can exceed 10 MB.

### Simple vs Composite Fonts

- **Simple fonts** (Type1, TrueType): Single-byte character codes (0–255), mapped to glyphs via `/Encoding` + optional `/Differences` array.
- **Composite fonts** (Type0/CIDFont): Multi-byte character codes. A CMap maps codes → CIDs, then `/CIDToGIDMap` maps CIDs → GIDs. Much more complex to manipulate safely.

### DPI Is Not Stored in PDFs

PDFs don't have a DPI field. Effective DPI must be estimated from image pixel dimensions vs the containing page size in points: `effectiveDpi = imagePixels * 72 / pageSizeInPoints`. This is a conservative lower-bound estimate (assumes image fills the page).

### Content Streams and Text Operators

PDF content streams use postfix notation. Text-showing operators:
- `Tj` — show a single string
- `TJ` — show array of strings with positioning adjustments
- `'` — newline + show string
- `"` — set spacing, newline, show string

The strings are **not Unicode** — they're character codes whose meaning depends on the active font's encoding. The `Tf` operator sets the current font.

**Edge cases in content stream parsing:**
- Content streams can be an array of stream refs (concatenated in order)
- pdf-lib represents programmatically-created content as `PDFContentStream` (not `PDFRawStream`) — must check for `getUnencodedContents()` method
- Form XObjects (`/Subtype /Form`) referenced by the `Do` operator have their own `/Resources` and content stream — must recurse into them
- Inline images (`BI`/`ID`/`EI`) must be skipped — the `ID` marker is followed by raw binary data terminated by `EI`
- Font names in content streams (e.g., `/F1` in `Tf`) must be resolved through the page's `/Resources/Font` dict to find the actual font object ref

---

## Tooling & Libraries

### pdf-lib

**Strengths:** Excellent low-level access to PDF objects via `context.enumerateIndirectObjects()`. Can directly manipulate `PDFRawStream`, `PDFDict`, `PDFArray`, etc. Good enough for all optimization passes without needing a custom parser.

**Limitations:**
- No built-in content stream parser (would need to write one for glyph extraction).
- `PDFNumber` value access is inconsistent — use `Number(val.toString())` for reliable extraction, not `.numberValue()` or `.value()` which behave differently depending on how the number was created (original parse vs `context.obj()`).
- `page.getSize()` is the clean way to get page dimensions; don't try to parse `/MediaBox` manually.

### jpeg-js

Pure JS JPEG encoder/decoder (~15 KB). Chosen over `OffscreenCanvas` because OffscreenCanvas isn't available in Node test environments (vitest). Works in both Web Workers and Node.

**Buffer shim required in browser:** The encoder (`lib/encoder.js`) checks `typeof module === 'undefined'` to decide whether to return `new Uint8Array(byteout)` (browser) or `Buffer.from(byteout)` (Node). In a Vite-bundled Web Worker, the bundler shims `module` for CJS compatibility, so the check fails and the encoder takes the Node.js `Buffer.from()` path — which doesn't exist in browsers. The decoder has a `useTArray: true` option that avoids `Buffer`, but the encoder has no equivalent. Fix: provide a minimal `globalThis.Buffer` shim (`{ from: arr => new Uint8Array(arr), alloc: size => new Uint8Array(size) }`) before jpeg-js is invoked.

### fflate

Pure JS zlib, faster and smaller than pako. Used for `deflateSync`/`inflateSync`. Level 9 recompression of existing streams is a reliable win — many PDFs use low compression levels or no compression at all.

---

## Optimization Techniques

### Stream Recompression

Many PDF producers (especially Illustrator, older tools) use Flate level 1–6 or even leave streams uncompressed. Recompressing everything at level 9 is a safe, lossless win. Typical savings: 5–15% on streams alone.

### Object Deduplication

Hash-based dedup using djb2. Surprisingly common in real PDFs — fonts and images are often embedded multiple times (e.g., TrueType + Type1 copies of the same font). Our implementation hashes the raw stream bytes and replaces all duplicate refs with a single canonical copy.

### Standard Font Unembedding

The PDF spec guarantees that all conforming readers provide the 14 base fonts (Helvetica, Courier, Times-Roman, Symbol, ZapfDingbats, and their bold/italic variants). Many tools (Illustrator, InDesign) embed full copies anyway — often 50–200 KB per font.

**Safe to unembed:** Type1 and TrueType simple fonts with standard or no custom encoding.

**Not safe to unembed:** Type0/CIDFont composites (use 2-byte Identity-H encoding; unembedding would require rewriting content stream text operators) and fonts with custom `/Encoding << /Differences [...] >>` arrays (the differences might reference glyphs not present in the reader's built-in font).

### Image Recompression

Two paths for lossy image optimization:

1. **FlateDecode → JPEG**: Raw pixel data compressed with zlib is decoded and re-encoded as JPEG. Massive win for photographic content.
2. **DCTDecode → DCTDecode**: Existing JPEG images are decoded via `jpeg-js` and re-encoded at the target quality/DPI. This is the common case in real-world PDFs.

Key considerations:

- **Skip JPXDecode** — JPEG2000 images can't be decoded by `jpeg-js`.
- **DCTDecode images are re-encoded** — decoded with `jpegDecode(rawBytes, { useTArray: true })` (the `useTArray` flag is critical for Web Worker compatibility — without it, jpeg-js tries to use Node.js `Buffer`). Re-encoded at the user's target quality. Generation loss is mitigated by the per-image size guard.
- **Skip SMask images** — these have alpha channels that JPEG can't represent.
- **Skip small images** — below 10 KB decoded RGBA data, the overhead isn't worth it.
- **Size guard per image** — only replace if JPEG output is smaller than the original compressed stream. This prevents quality degradation when re-encoding at a similar or higher quality than the original.

### Image Downsampling

Area-average (box filter) resampling before JPEG encoding. For each destination pixel, averages all source pixels that map to it — simple, no dependencies, good quality for downscaling.

DPI estimation uses a page map built by walking all pages' `Resources → XObject` dicts to find which ref appears on which page size. Conservative approach: uses `Math.min(dpiX, dpiY)` so we never over-downsample.

### Font Subsetting

Strips unused glyph outlines from embedded font programs. Typical savings: 50–98% per font. Lossless — only removes glyphs the document doesn't reference.

**Character code → Unicode pipeline:**
- Simple fonts (Type1/TrueType): charCode → `/Encoding` (WinAnsi, MacRoman, or `/Differences` array) → glyph name → Adobe Glyph List → Unicode codepoint
- Composite fonts (Type0/Identity-H): 2-byte charCode → `/ToUnicode` CMap → Unicode codepoint

**retain-gids flag:** For Type0/Identity-H fonts, harfbuzzjs must be called with `HB_SUBSET_FLAGS_RETAIN_GIDS` (0x2). Without it, the subsetter would renumber glyph IDs, breaking the CID=GID identity mapping. With retain-gids, GID slots for removed glyphs are zeroed out but keep their positions, so no updates to `/CIDToGIDMap` or `/W` (widths) are needed.

**V1 scope:** Only Type1/TrueType (simple) and Type0 with Identity-H + Identity CIDToGIDMap are supported. Type0 with non-Identity CMaps, Type3 fonts, fonts < 10 KB, and fonts without `/ToUnicode` or recognizable encoding are skipped.

**Pass ordering matters:** font-subset runs after font-unembed (no point subsetting fonts we'll remove) and before dedup (so dedup can catch fonts that become identical after subsetting).

### Metadata Stripping

Application-private data is surprisingly large. Illustrator's `AIPrivateData` can be hundreds of KB. XMP metadata, `PieceInfo`, Photoshop IRB — all safe to strip without affecting the visual output or user-facing metadata (title, author, subject are preserved separately in `/Info`).

### PDF/A Conformance Levels and What's Safe to Optimize

PDF/A is an ISO standard (19005) for long-term archival of PDF documents. Several conformance levels exist:

- **PDF/A-1** (based on PDF 1.4): The strictest. Prohibits encryption, JavaScript, LZW compression, transparency, and **object streams**. All fonts must be embedded. XMP metadata with `pdfaid:part`/`pdfaid:conformance` is mandatory.
- **PDF/A-2** (based on PDF 1.7): Relaxes PDF/A-1 restrictions. Allows JPEG2000 compression, transparency, and **object streams**.
- **PDF/A-3**: Same as PDF/A-2, but allows embedding arbitrary file attachments.
- **PDF/A-4** (based on PDF 2.0): Further modernization; recommends Associated Files for XMP Extension Schemas.

Within each level, conformance 'a' requires tagged structure (StructTreeRoot, MarkInfo), while 'b' only requires faithful visual reproduction. Level 'u' (PDF/A-2u, 3u) adds a Unicode mapping requirement.

**What's safe to optimize on PDF/A:**
- Stream recompression (better Flate) — safe, lossless
- Object deduplication — safe (doesn't break references)
- Font subsetting — safe (fonts remain embedded, just smaller)
- Removing PieceInfo, AIPrivateData, Photoshop, Illustrator bloat — safe (application-private data, not required by any PDF/A level)
- Unreferenced object removal — safe (OutputIntent, StructTreeRoot, and other required catalog entries are all reachable from the trailer via BFS)

**What breaks PDF/A conformance:**
- Removing embedded fonts (font-unembed) — **blocked** for PDF/A
- Removing XMP metadata — **blocked** for PDF/A (the `pdfaid:` declaration itself lives in XMP)
- Using `useObjectStreams: true` for PDF/A-1 — **known limitation** (see below)

**Object streams and PDF/A-1 (resolved):** PDF/A-1 (based on PDF 1.4) prohibits object streams. The pipeline now conditionally disables `useObjectStreams` when `pdfALevel` starts with `1`. PDF/A-2+ files still benefit from object stream compression.

### PDF/UA Requirements

PDF/UA (ISO 14289) governs universal accessibility. Key requirements:
- All meaningful content must be tagged and in the structure tree
- All fonts must be embedded (same constraint as PDF/A)
- Document language must be declared via `/Lang` on the catalog
- Logical reading order via depth-first traversal of the structure tree
- Images and graphics require `/Alt` or `/ActualText` attributes

Font unembedding is blocked for PDF/UA documents, matching the PDF/A behavior. The pass returns `pdfuaSkipped: true` when `_pdfTraits.isPdfUA` is set.

### Accessibility Impact of Optimization

PDF optimization can silently break accessibility. Key risks and mitigations:

**Mitigated risks:**
- **ToUnicode CMaps** are critical for screen readers. When unembedding standard fonts, the entire font dict gets rebuilt — must explicitly save and restore `/ToUnicode` before clearing entries.
- **XMP metadata** can contain `dc:language`, the document language tag. Screen readers use `/Lang` (on the catalog) to determine pronunciation. Before stripping XMP, extract `dc:language` and migrate it to `/Lang` if not already set.
- **Tagged PDFs** (those with `/MarkInfo` and `/StructTreeRoot`) are safe through the full pipeline. The BFS traversal in `unreferenced.js` starts from the catalog, which references `/StructTreeRoot` and its descendants — confirmed by tests with tagged PDFs containing orphan objects (orphans removed, structure tree preserved).
- **PDF/A compliance** — the pipeline auto-detects PDF/A via XMP `pdfaid:part` and disables font unembedding and XMP stripping. Bloat keys (PieceInfo, AIPrivateData, etc.) are still stripped — they're not part of the conformance requirement.
- **OutputIntent** (required by PDF/A) is stored as `/OutputIntents` on the catalog dict, so BFS always reaches it. Never removed as unreferenced.

**Safe by design (no fix needed):**
- **Object deduplication** only processes `PDFRawStream` objects. Structure tree elements (`/StructElem`) are plain `PDFDict` objects and are never merged.
- **Font subsetting** reduces font size but keeps the font embedded. Safe for both PDF/A and PDF/UA.

### `_pdfTraits` Detection and Flow

`pipeline.js` calls `detectAccessibilityTraits(pdfDoc)` after loading, injects the result as `options._pdfTraits` (spread into a new options object, not mutation), and includes `pdfTraits` in the returned stats. Individual passes read `options._pdfTraits?.isPdfA` etc. to decide whether to skip.

**XMP conformance parsing** handles both element-style (`<pdfaid:part>1</pdfaid:part>`) and attribute-style (`pdfaid:part="1"`) XMP, since different PDF producers use different styles. The `parseConformanceFromXmp()` utility in `utils/accessibility-detect.js` is exported separately so other passes can reuse it.

---

## Testing Patterns

### Test Fixture Image Data

**Use sine-wave patterns, not random noise.** Random noise (`Math.random()`) has high entropy that deflates poorly — but it *also* compresses poorly as JPEG. This means the JPEG output can end up *larger* than the deflated random data, causing the size guard to skip the image and making the test meaningless.

Smooth sine-wave patterns (`Math.sin(x * freq)`) are photo-like: they compress poorly with lossless Flate (no exact byte repeats) but excellently with JPEG (smooth gradients). This correctly exercises the "JPEG is smaller" path.

### PDF Number Value Extraction in Tests

When reading numeric values from pdf-lib dicts in tests, `Number(val.toString())` works reliably across all PDFNumber creation methods. The `.numberValue()` / `.value()` accessors return `NaN` or `undefined` in some cases depending on whether the number came from parsing or `context.obj()`.

### Object Classification for Inspection

Classifying PDF objects by semantic type requires multiple pre-passes because many objects lack self-identifying `/Type` entries:

- **Font file streams** (FontFile/FontFile2/FontFile3) have no `/Type` — they must be identified by walking FontDescriptor dicts and collecting refs to their font file entries.
- **Content streams** are plain streams referenced from page `/Contents` — must walk pages to build a ref→page mapping.
- **Image resource names** (e.g., `Im0`) are stored in the page's `/Resources/XObject` dict, not on the image stream itself.

**Indirect ref resolution is critical.** Page `/Resources` and `/XObject` entries are frequently indirect references (`PDFRef`), not inline dicts. Forgetting to `context.lookup()` silently skips entire pages.

**PDFRawStream extends PDFDict** in pdf-lib. An `instanceof PDFDict` check matches streams too. When searching for non-stream dicts (e.g., FontDescriptors), always add `|| obj instanceof PDFRawStream` to the exclusion guard.

**Size measurement:** Stream `contents.length` (compressed bytes) is the meaningful size metric for understanding where bytes go. Non-stream objects (dicts, arrays, numbers) contribute negligible overhead compared to streams and can be summarized rather than listed individually.

### Sub-categorizing "Other" Objects

The "Other" (now "Other Data") bucket in the object inspector is a massive dumping ground without further classification. Most objects in it can be identified by checking for characteristic dictionary keys:

- **ICC color profiles:** have both `/N` (number of components) and `/Alternate` (fallback colorspace) keys.
- **CMaps:** have a `/CMapName` key — these are Unicode mapping tables for composite fonts.
- **Font encodings:** have a `/Differences` array that overrides a base encoding.
- **Glyph widths:** have a `/Widths` array of per-character advance widths.
- **CID system info:** have a `/Registry` key (typically `"Adobe"`).
- **Form XObjects:** streams with `/Subtype /Form` — reusable graphics snippets.
- **Annotations:** `/Type /Annot` or subtypes like `/Link`, `/Widget`.

Objects that don't match any of these heuristics fall into "Miscellaneous" (generic streams/dicts). Showing individual items for Miscellaneous adds visual noise without insight — a summary count + total size is sufficient.

### Benchmark Fixture Design

Reference PDFs for benchmark testing need to be more complex than unit-test fixtures. Key patterns:

- **Multiple bloat vectors per fixture.** A realistic Illustrator-export PDF has embedded standard fonts AND XMP AND PieceInfo AND duplicate objects AND poor compression — all at once. Each fixture should exercise multiple optimization passes simultaneously.
- **Return bytes, not PDFDocument.** Benchmark generators return `Uint8Array` (saved bytes) to match the pipeline's `optimize(inputBytes)` contract, unlike unit-test fixtures which return `PDFDocument`.
- **Wide compression ranges.** Compression ratios for synthetic data are intentionally wide (e.g., `>= 30%` rather than `30-50%`) to avoid flakiness. Synthetic PDFs don't have the same bloat profile as real-world documents — the overhead of PDF structure objects relative to content is different. Tighten thresholds after measuring against actual real-world files.
- **`beforeAll` for pipeline tests.** Run `optimize()` once in `beforeAll`, then assert many properties from the returned `stats` and reloaded `PDFDocument`. This avoids re-running the full pipeline (8 passes) for each assertion.
- **Verification utility layer.** Functions like `getEmbeddedFonts()`, `getMetadataStatus()`, and `getStructureTreeInfo()` inspect a loaded `PDFDocument` and return structured results, keeping test assertions clean and reusable across suites.

### Font Subset Prefix Stripping

PDF font names often carry a 6-letter subset prefix (e.g., `ABCDEF+Helvetica`). This prefix is an artifact of subsetting and meaningless to end users. The prefix always follows the pattern `[A-Z]{6}+` and can be safely stripped for display purposes using `/^[A-Z]{6}\+/`.

---

## Code Architecture

### Debug Mode (`?debug` URL Parameter)

Debug mode is activated by adding `?debug` to the URL (e.g., `localhost:5173/?debug`). It provides structured diagnostic information without cluttering the UI for normal users.

**How it works:**
- `collectOptions()` in `main.js` reads the `?debug` URL param and sets `options.debug: true`
- `pipeline.js` wraps each pass with `Date.now()` timing, adding `_ms` to every pass's stats object
- Individual passes can return a `_debug` array of structured log entries and a `skipReasons` counter object when `options.debug` is true — this replaces ad-hoc `console.log` debugging
- `main.js` renders a collapsible `<details>` debug panel below each file's results when debug mode is active

**Adding debug output to a new pass:**
```js
export function myPass(pdfDoc, options = {}) {
  const { debug = false } = options;
  const debugLog = debug ? [] : null;
  // ... during processing:
  if (debugLog) debugLog.push({ ref: ref.toString(), action: 'skip', reason: 'some reason' });
  // ... return:
  return { myCount, ...(debugLog && { _debug: debugLog }) };
}
```

The `_debug` field is optional — passes that don't return it are simply displayed with their timing. The UI auto-discovers `_debug` arrays and renders them in the debug panel.

### Layer Discipline: Utils Should Not Import from Optimize Passes

During initial development, `getFilterNames()` ended up in `streams.js` (an optimization pass) even though it's a general utility for reading PDF stream filter dictionaries. Four other modules — including two utils — imported it from there, creating a cross-layer dependency (utils → optimize). This was refactored: `getFilterNames()` now lives in `stream-decode.js` alongside other filter-related utilities (`hasImageFilter`, `allFiltersDecodable`). `streams.js` re-exports it for backward compatibility.

**Rule of thumb:** if more than one optimization pass needs a function, it belongs in `utils/`. If a util needs a function from a pass, that function is in the wrong place.

### Shared Constants and Functions

`hashBytes()` (djb2 hash) and `FONT_FILE_KEYS` (`['FontFile', 'FontFile2', 'FontFile3']`) were independently duplicated across `dedup.js`, `fonts.js`, and `font-subset.js`. Extracted into `utils/hash.js`. When adding new passes that need hashing or font-file traversal, import from there rather than copying.

### ASCII85 Encoding Gotcha

ASCII85 encodes 4 bytes into 5 ASCII characters. A 5-character group always decodes to 4 bytes — there's no 3-byte output from a full 5-char group. Short final groups (fewer than 5 chars) produce fewer bytes (count - 1), but a complete group like `9jqo^` decodes to 4 bytes (`Man ` with trailing space), not 3.

---

## Browser Constraints

### Web Worker Boundary

All PDF processing runs in a Web Worker. The main thread sends an `ArrayBuffer` (transferred, not copied) and receives progress messages + the final result. UI never touches pdf-lib directly. This keeps the UI responsive during heavy processing.

### WASM in Web Workers

WASM modules (like harfbuzzjs for font subsetting) can be instantiated inside Web Workers in all modern browsers. Adds ~100–200ms initialization latency for a ~3 MB module. Should be lazy-loaded only when the feature is needed.

---

## Font Subsetting Libraries (Evaluated)

| Library | Bundle | TrueType | CFF/OpenType | Maintained | Verdict |
|---------|--------|----------|-------------|------------|---------|
| **subset-font** (harfbuzzjs) | ~3.2 MB WASM | Yes | Yes | Active (Feb 2026) | Best overall — industry-standard HarfBuzz engine |
| **fontkit** | ~5.6 MB | Yes | Yes | Stale (2+ years) | Best API for PDF (glyph-ID-based), but unmaintained |
| **harfbuzzjs** (direct) | ~3.1 MB WASM | Yes | Yes | Active | Low-level, needs substantial glue code |
| **fonteditor-core** | ~1.6 MB | Yes | Converts to TTF | Active | Disqualified — CFF conversion is lossy |
| **opentype.js** | ~3.8 MB | Partial | No subsetting | Moderate | Disqualified — no subset API |

**Decision:** Direct harfbuzzjs WASM (calling the C API ourselves) is the best choice. HarfBuzz is used by Chrome, Firefox, and Android — it correctly handles compound glyphs, GSUB/GPOS layout tables, and complex scripts. The ~596 KB gzipped WASM cost is mitigated with lazy loading as a separate chunk.

**Key trade-off:** harfbuzzjs's API is Unicode-based (you pass codepoints to keep), so PDF character codes must be reverse-mapped to Unicode via the font's `/ToUnicode` CMap or `/Encoding`.

### harfbuzzjs CJS/ESM Interop

harfbuzzjs's `index.js` does `module.exports = new Promise(...)`. When Vitest transforms this CJS module into ESM, the Promise's `.then` method leaks onto the module namespace object, making it look like a thenable. `await import('harfbuzzjs')` then tries to call `.then()` on the module, causing `TypeError: Method Promise.prototype.then called on incompatible receiver [object Module]`.

**Fix:** Don't import the harfbuzzjs JS wrapper at all. Load `hb-subset.wasm` directly via `require.resolve('harfbuzzjs/hb-subset.wasm')` (Node) or `new URL('harfbuzzjs/hb-subset.wasm', import.meta.url)` (browser) and call `WebAssembly.instantiate()` ourselves. The JS wrapper is for the shaping API; we only need the subsetting C API exports.

### pdf-lib Lazy Object Creation

pdf-lib creates font dict objects lazily — after `embedFont()` + `drawText()`, the actual PDF objects (FontDescriptor, FontFile2, CIDFont, etc.) don't exist in `context` until `save()` is called. Testing font subsetting requires a save/reload cycle: `doc.save({ useObjectStreams: false })` then `PDFDocument.load(saved)`.

### pdf-lib Uses pako Internally

pdf-lib uses pako for internal compression. fflate's `inflateSync` can fail with "unexpected EOF" on some pako-produced zlib streams, but `decompressSync` (full zlib-wrapper handling) succeeds. The `decodeFlateDecode` function should try `inflateSync` first and fall back to `decompressSync`.

### Node.js fetch() Detection

Node.js 18+ has a global `fetch()`, so `typeof fetch === 'function'` is true in both browser and Node. For environment detection, use `typeof process !== 'undefined' && process.versions?.node` to identify Node.js before checking for `fetch`.

# PDF-A-go-slim — Learnings & Technical Notes

Technical knowledge accumulated during development. Updated as we go.

This project grew out of [PDF-A-go-go](https://github.com/khawkins98/PDF-A-go-go), a lightweight embeddable PDF viewer built on PDF.js. While creating a demo PDF for that project's showcase page, a clean 32 KB file ballooned to 198 KB after a minor Illustrator edit — redundant font embeddings, metadata bloat, duplicate objects. The existing tools (Ghostscript, qpdf, online services) each solved part of the problem but none solved all of it in the browser. PDF-A-go-slim applies every optimization technique we could find, entirely client-side. The two projects share a philosophy: no server, no framework, pure browser.

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
- **Inline font dicts** (rare): some PDFs define font dictionaries inline rather than as indirect refs. The parser creates synthetic ref keys (`inline:{fontName}`) to track these without crashing. See `content-stream-parser.js`.

### Building a Content Stream Parser

The content stream parser (`content-stream-parser.js`) is a ~500-line stack-based tokenizer that processes PDF postfix notation. It handles:

- **Literal strings** with nested parentheses (balanced `(` `)` pairs) and all PDF escape sequences (`\n`, `\r`, `\t`, `\\`, octal `\ddd`)
- **Hex strings** (`<48656C6C6F>`)
- **Names** (`/FontName`) with `#XX` hex escape sequences
- **Numbers** (integers and floats, including negative)
- **Arrays** (`[...]`) via recursive descent
- **Comments** (`%` to end of line)
- **Inline images** (`BI ... ID <binary> EI`) — the trickiest part because `ID` is followed by arbitrary binary data; the parser scans forward for `\nEI` or ` EI` to find the end marker

The operator dispatch table maps PDF text operators (`Tf`, `Tj`, `TJ`, `'`, `"`) to handler functions that extract character codes from the operand stack. The `Do` operator triggers recursive parsing into Form XObjects with resource dictionary fallback to the parent page.

---

## Tooling & Libraries

### pdf-lib

**Strengths:** Excellent low-level access to PDF objects via `context.enumerateIndirectObjects()`. Can directly manipulate `PDFRawStream`, `PDFDict`, `PDFArray`, etc. Good enough for all optimization passes without needing a custom parser.

**Limitations:**
- No built-in content stream parser (would need to write one for glyph extraction).
- `PDFNumber` value access is inconsistent — use `Number(val.toString())` for reliable extraction, not `.numberValue()` or `.value()` which behave differently depending on how the number was created (original parse vs `context.obj()`).
- `page.getSize()` is the clean way to get page dimensions; don't try to parse `/MediaBox` manually.
- **Cannot read metadata streams.** pdf-lib only reads the `/Info` dictionary for metadata (`getTitle()`, `getAuthor()`, etc.). PDFs that store metadata exclusively in XMP metadata streams (common in modern tools) return `undefined` from these accessors. This is why we read XMP directly from raw stream bytes in `metadata.js` rather than using pdf-lib's metadata API.

### jpeg-js

Pure JS JPEG encoder/decoder (~15 KB). Chosen over `OffscreenCanvas` because OffscreenCanvas isn't available in Node test environments (vitest). Works in both Web Workers and Node.

**Buffer shim required in browser:** The encoder (`lib/encoder.js`) checks `typeof module === 'undefined'` to decide whether to return `new Uint8Array(byteout)` (browser) or `Buffer.from(byteout)` (Node). In a Vite-bundled Web Worker, the bundler shims `module` for CJS compatibility, so the check fails and the encoder takes the Node.js `Buffer.from()` path — which doesn't exist in browsers. The decoder has a `useTArray: true` option that avoids `Buffer`, but the encoder has no equivalent. Fix: provide a minimal `globalThis.Buffer` shim (`{ from: arr => new Uint8Array(arr), alloc: size => new Uint8Array(size) }`) before jpeg-js is invoked.

### fflate

Pure JS zlib, faster and smaller than pako. Used for `zlibSync`/`inflateSync`/`decompressSync`. Level 9 recompression of existing streams is a reliable win — many PDFs use low compression levels or no compression at all.

**The three fflate functions and when to use each:**
- `zlibSync(data, { level })` — **compression**. Always use this for PDF FlateDecode streams. Produces zlib-wrapped DEFLATE (RFC 1950, 2-byte header starting `0x78`, 4-byte Adler-32 checksum). 6 bytes overhead vs raw DEFLATE, but macOS Preview and other viewers silently render blank pages without the zlib wrapper.
- `inflateSync(data)` — **decompression of raw DEFLATE only** (RFC 1951, no wrapper). Fast path for most streams. Correctly rejects zlib-wrapped data — this is by design, not a bug.
- `decompressSync(data)` — **decompression with auto-format detection** (GZIP, Zlib, or raw DEFLATE). Used as fallback when `inflateSync` fails on pako-produced zlib streams (pdf-lib uses pako internally).

**`mem` option for `zlibSync`:** fflate supports `mem: 0-12` (memory level) — higher values increase speed and compression ratio at exponential memory cost (level 4 = 64 KB, level 8 = 1 MB, level 12 = 16 MB). Default is auto-sized per input. Values above 8 rarely help. Not worth tuning for our use case, but good to know for future profiling.

**Never use `deflateSync` for PDF streams.** See the CalRGB bug story below — this was our most insidious bug.

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

**How the box filter handles fractional boundaries:** Each destination pixel maps to a rectangular region of source pixels. When that region doesn't align to pixel boundaries, the overlapping source pixels are weighted by their fractional coverage area (`wx * wy`). This produces smooth, artifact-free downscaling without the blocky artifacts of nearest-neighbor or the blur of naive bilinear. The algorithm is ~40 lines of JavaScript with no dependencies — a weighted average over a variable-size kernel. See `images.js` `downsampleArea()`.

### Font Subsetting

Strips unused glyph outlines from embedded font programs. Typical savings: 50–98% per font. Lossless — only removes glyphs the document doesn't reference.

**Character code → Unicode pipeline:**
- Simple fonts (Type1/TrueType): charCode → `/Encoding` (WinAnsi, MacRoman, or `/Differences` array) → glyph name → Adobe Glyph List → Unicode codepoint
- Composite fonts (Type0/Identity-H): 2-byte charCode → `/ToUnicode` CMap → Unicode codepoint

**retain-gids flag:** For Type0/Identity-H fonts, harfbuzzjs must be called with `HB_SUBSET_FLAGS_RETAIN_GIDS` (0x2). Without it, the subsetter would renumber glyph IDs, breaking the CID=GID identity mapping. With retain-gids, GID slots for removed glyphs are zeroed out but keep their positions, so no updates to `/CIDToGIDMap` or `/W` (widths) are needed. **Trade-off:** zeroed-out GID slots waste a small amount of space (empty glyph outlines), but the alternative — rewriting every `/W` width array and `/CIDToGIDMap` in the document — is fragile and error-prone. The wasted space is negligible compared to the removed glyph outlines.

**Unicode mapping fallback hierarchy:** When mapping character codes to Unicode for subsetting, the pipeline tries sources in priority order: (1) `/ToUnicode` CMap if present (most reliable, handles arbitrary mappings), (2) `/Encoding` dictionary (WinAnsi, MacRoman, or custom `/Differences` array) → glyph name → Adobe Glyph List, (3) `uniXXXX` glyph name convention (e.g., `uni0041` → U+0041), (4) ASCII range guess (char code 0x20–0x7E → same Unicode). If none of these resolve, the font is skipped entirely. See `unicode-mapper.js`.

**Surrogate pair handling in ToUnicode:** CMap values longer than 4 hex characters are split into 4-char chunks and checked for UTF-16 surrogate pairs (high 0xD800–0xDBFF followed by low 0xDC00–0xDFFF). Surrogate pairs are decoded to their full Unicode codepoint via `0x10000 + ((hi - 0xD800) << 10) + (lo - 0xDC00)`. This handles CJK characters and emoji in the Supplementary Multilingual Plane. See `unicode-mapper.js` `parseUnicodeHex()`.

**V1 scope:** Only Type1/TrueType (simple) and Type0 with Identity-H + Identity CIDToGIDMap are supported. Type0 with non-Identity CMaps, Type3 fonts, fonts < 10 KB, and fonts without `/ToUnicode` or recognizable encoding are skipped.

**GID-based subsetting for cmap-less fonts:** Many already-subsetted Type0/CIDFontType2 fonts have their `cmap` table stripped by the original PDF producer. This is normal — with Identity-H encoding and Identity CIDToGIDMap, the PDF viewer maps CID directly to GID without needing a Unicode lookup inside the font program. However, harfbuzzjs's Unicode-based subsetting (`hb_subset_input_unicode_set`) internally uses the font's `cmap` to resolve Unicode → GID. If no `cmap` exists, harfbuzz finds zero matching glyphs and outputs a font with only `.notdef` — rendering all text invisible. **Fix:** detect cmap-less fonts by parsing the TrueType table directory (12-byte header + 16-byte table records, look for the `cmap` tag). When a Type0/Identity-H font lacks a `cmap`, extract raw CIDs from the content stream and pass them directly as GIDs via `hb_subset_input_glyph_set()`, bypassing the Unicode mapping entirely. This works because Identity CIDToGIDMap means CID=GID. See `font-subset.js` `fontHasCmap()` and `harfbuzz-subsetter.js` `useGlyphIds` option. Discovered via UNDRR-Work-Programme-2026-2027.pdf where the `AAAAAF+Roboto-Light` Type0 font was reduced to 1 glyph (broken) instead of retaining all 1,836 used GID slots.

**Correctness guards vs configurable options:** The font subsetting pass has several safety guards that might look like they could be exposed as advanced configuration. They cannot — they are correctness requirements, not trade-offs:

- **Cmap-less GID-based subsetting** — When a font has no cmap table, Unicode-based subsetting *cannot work* (harfbuzz resolves every glyph to `.notdef`). GID-based subsetting is the only correct algorithm. There's no user scenario where forcing Unicode-based subsetting would help.
- **Skip simple fonts with subset prefix (`ABCDEF+`)** — These fonts have renumbered char codes (FirstChar 33+) that only make sense through the embedded cmap. Unicode-based re-subsetting uses a different mapping path, always producing invisible or wrong text. No trade-off here.
- **Skip subset-prefixed fonts for unembedding** (in `font-unembed.js`) — Unembedding a subset font without explicit encoding always corrupts glyph mapping. The compact char codes depend on the embedded cmap table; switching to WinAnsiEncoding maps them to wrong glyphs.

What *could* be useful advanced options in the future: (1) minimum font size threshold (currently 10 KB), (2) subset scope — "only Type0 fonts" vs "Type0 + simple fonts" — since Type0/Identity-H is the safer, more battle-tested path.

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

### Accessibility Auditing (Lightweight)

The `auditAccessibility()` function in `accessibility-detect.js` runs three lightweight audits on the optimized document (post-pipeline, pre-save):

**ToUnicode coverage:** Enumerates indirect objects with `Type: Font`, skips Type3 and CIDFont descendants (they're counted via their Type0 parent). Checks for `/ToUnicode` entry. Fonts without ToUnicode mappings can't be reliably extracted to text by screen readers or search indexers.

**Image alt text:** Counts image XObjects (`Subtype: Image`), then walks StructElem objects with `/S /Figure` and checks for `/Alt`. If no StructTreeRoot exists, the `figures` field is `null` (alt text requires a tagged PDF). The audit reports both totalImages and figures separately — a PDF can have many images but no Figure StructElems if it's not tagged.

**Structure tree depth:** Recursive walk from `/StructTreeRoot` through `/K` children. Uses a `visited` Set on ref tags to prevent cycles. Caps at depth 200. Reports element count, unique element types (sorted), and max depth. `null` if no structure tree exists.

All three audits use `context.enumerateIndirectObjects()` to scan the full object graph. This is O(n) in object count but runs in <10ms for typical documents. The audit runs on the optimized document so the report reflects the downloadable output.

**Real-world accessibility patterns observed across pdf.js test corpus:**

- Most tagged PDFs lack PDF/A and PDF/UA conformance metadata even when well-structured. These are separate authoring concerns — a PDF can be fully tagged with rich structure trees yet have no XMP conformance claims.
- Document-level `/Lang` is often missing even in tagged PDFs. Some producers set language only at the StructElem level, which doesn't satisfy the catalog-level `/Lang` check that PDF/UA requires.
- ToUnicode coverage varies even in PDF/UA-conformant files — standard fonts like Helvetica and ZapfDingbats sometimes lack ToUnicode CMaps.
- Figure StructElems with `/Alt` are uncommon. Even the best-tagged test PDF (`pdfjs_wikipedia.pdf` — 285 struct elements, 13 types) only has 1 of 3 figures with alt text.
- Image XObject count and Figure StructElem count are independent metrics. A document can have many image XObjects but zero Figure elements (untagged), or Figure elements that reference non-image content.
- The `/Type` key on StructElem dicts is optional per the PDF spec. Filtering StructElems by `/Type /StructElem` will match correctly (objects with a different `/Type` are excluded, objects with no `/Type` pass through to the `/S` check), but this relies on the secondary `/S` filter to avoid false positives from non-StructElem dicts that happen to lack `/Type`.
- `PDFStream` in pdf-lib does NOT extend `PDFDict` — it has a `.dict` property instead. Always use `obj.dict.get()` for stream objects, not `obj.get()` directly. The `instanceof PDFDict` check correctly distinguishes the two.

### Additional Checks Inspired by PDFcheck

[PDFcheck](https://github.com/jsnmrs/pdfcheck) by Jason Morris ([blog post](https://jasonmorris.com/code/pdfcheck/)) performs several lightweight accessibility checks using regex on raw PDF text. We adopted the most useful techniques using pdf-lib's typed object model instead:

- **Document Title** — WCAG 2.x SC 2.4.2 requires a meaningful title. We check XMP `dc:title` first (via `parseTitleFromXmp()`), falling back to `pdfDoc.getTitle()` from the Info dict.
- **DisplayDocTitle** — PDF/UA requires `/ViewerPreferences << /DisplayDocTitle true >>` so the viewer title bar shows the document title instead of the filename. We read this from the catalog and report true/false/null (not configured).
- **Marked status nuance** — PDFcheck distinguishes "Marked explicitly false" from "no MarkInfo at all". We now report `markedStatus: 'true' | 'false' | 'missing'` alongside the existing `isTagged` boolean.

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

### Custom LZW Decoder

We had to write our own LZW decoder because PDF's variant has non-standard behavior: **early code size change**. Standard LZW (GIF, TIFF) waits until code `N` is emitted before widening the code size, but PDF's variant widens one code earlier. Getting this wrong produces garbage output from otherwise-valid streams. No off-the-shelf JS LZW library handles this correctly.

The decoder (`stream-decode.js` `decodeLZW()`, ~65 lines) also differs from GIF's LZW in bit ordering — PDF uses MSB-first (big-endian) within bytes, while GIF is LSB-first. Encountering LZW in the wild is rare (mostly older PDF producers), but when it appears, there's no fallback — the stream is unreadable without a correct decoder.

### PNG Row Prediction in PDF Streams

Some PDF producers apply PNG row prediction (Predictor 10–15) before Flate compression to improve compression ratios on image-like data. After Flate decompression, this prediction must be reversed to recover the original bytes. We encountered this in real-world PDFs with embedded raster images using FlateDecode + DecodeParms.

The reversal handles five filter types (None, Sub, Up, Average, Paeth). The Paeth predictor is the most interesting — it approximates linear interpolation in 2D using only the left, above, and upper-left neighbors. Six lines of code, but the math is non-obvious. See `stream-decode.js` `undoPngPrediction()` and `paethPredictor()`.

### ASCII85 Encoding Gotcha

ASCII85 encodes 4 bytes into 5 ASCII characters. A 5-character group always decodes to 4 bytes — there's no 3-byte output from a full 5-char group. Short final groups (fewer than 5 chars) produce fewer bytes (count - 1), but a complete group like `9jqo^` decodes to 4 bytes (`Man ` with trailing space), not 3.

---

## UI Patterns

### Custom dataTransfer Types for Internal Drag-and-Drop

Native HTML5 drag-and-drop uses `e.dataTransfer.types.includes('Files')` to detect file drags from the OS. To support dragging internal elements (like sample PDF icons) onto the same drop zone, use a custom MIME type (e.g., `application/x-pdf-sample`) via `setData()`/`getData()`. This lets drop handlers distinguish internal drags from native file drags without ambiguity.

**Key gotcha:** `dragenter`/`dragover` handlers that gate on `types.includes('Files')` must also check for the custom type, or the full-page drop overlay won't appear for internal drags.

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

### fflate `deflateSync` vs `zlibSync` — the CalRGB blank-page bug

fflate provides two compression functions:
- `deflateSync` — raw DEFLATE (RFC 1951, no header)
- `zlibSync` — zlib-wrapped DEFLATE (RFC 1950, 2-byte header starting with `0x78`)

PDF's FlateDecode (ISO 32000, section 7.4.4) references both RFC 1950 (zlib) and RFC 1951 (raw), but in practice **most PDF viewers expect zlib-wrapped data**. macOS Preview, in particular, silently fails on raw DEFLATE — it doesn't error, it just renders the page blank.

**Symptom:** calrgb.pdf (322 KB, 17 pages of CalRGB color swatches) rendered blank after optimization. Content stream bytes survived byte-for-byte through the decode/re-encode cycle, all PDF structure was intact, but viewers showed white pages.

**Root cause:** `streams.js` used `deflateSync` to recompress streams, producing raw DEFLATE without the zlib header. calrgb.pdf's content streams were originally uncompressed (no Filter), so the pass added `/Filter /FlateDecode` with raw DEFLATE data — a combination viewers couldn't handle.

**Fix:** Replaced `deflateSync` with `zlibSync` in both `streams.js` and `font-subset.js`. The zlib header adds only 6 bytes overhead (2-byte header + 4-byte Adler-32 checksum) per stream.

**Why it wasn't caught earlier:** All test fixtures use fflate's `deflateSync` to create FlateDecode streams. The decode path (`inflateSync`/`decompressSync`) handles both formats. Tests only verify data integrity via pdf-lib reload, not actual rendering. The bug only manifests when a PDF viewer renders the output.

### BFS Traversal and PDFStream Subclasses

The BFS traversal in `pdf-traversal.js` should use `instanceof PDFStream` (the base class), not `instanceof PDFRawStream`. pdf-lib has multiple stream subclasses (`PDFRawStream`, `PDFFlateStream`, `PDFContentStream`). Using the base class is defensive against edge cases where streams aren't `PDFRawStream` instances.

**Defense in depth:** A `checkContentIntegrity()` function in `pipeline.js` runs after all passes and before `save()`. It checks each page's `/Contents` ref to ensure it resolves to an actual object — a dangling ref means an optimization pass incorrectly deleted a live content stream. If any page has a dangling ref, the pipeline falls back to original bytes (like the size guard). This catches bugs that would otherwise produce silently blank pages.

### Pipeline Safety: Two-Layer Guard + Per-Pass Error Isolation

The pipeline has three safety mechanisms:

1. **Per-pass error isolation.** Each of the 8 optimization passes runs inside a try/catch. If one pass throws (e.g., a font with an unusual encoding causes the subsetter to fail), the pipeline continues with the remaining passes. The error is logged in stats but doesn't abort the entire optimization. This is critical because real-world PDFs contain surprising structures — a pass that works on 99% of PDFs shouldn't block the other passes when it encounters the 1%.

2. **Content integrity check.** After all passes complete but before `save()`, `checkContentIntegrity()` walks every page and verifies each `/Contents` ref (or array of refs) still resolves to a live object. Dangling refs → fallback to original bytes.

3. **Size guard.** After `save()`, the pipeline compares output bytes against input bytes. If output >= input, it returns the original bytes unchanged. This prevents the edge case where optimization overhead (e.g., pdf-lib rewriting cross-references) makes the file larger.

The guards are ordered intentionally: integrity check catches corruption, size guard catches bloat regression. Both are invisible to the user — the optimized file is simply returned unchanged, with `stats.sizeGuard: true` or `stats.contentWarnings` flagging what happened.

### Node.js fetch() Detection

Node.js 18+ has a global `fetch()`, so `typeof fetch === 'function'` is true in both browser and Node. For environment detection, use `typeof process !== 'undefined' && process.versions?.node` to identify Node.js before checking for `fetch`.

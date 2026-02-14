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

### Image Recompression (FlateDecode → JPEG)

FlateDecode images in PDFs are essentially raw pixel data compressed with zlib. Converting to JPEG is a massive win for photographic content. Key considerations:

- **Skip DCT/JPX** — already JPEG-compressed, re-encoding would only degrade quality.
- **Skip SMask images** — these have alpha channels that JPEG can't represent.
- **Skip small images** — below 10 KB decoded, the overhead isn't worth it.
- **Size guard per image** — only replace if JPEG output is smaller than the original compressed stream.

### Image Downsampling

Area-average (box filter) resampling before JPEG encoding. For each destination pixel, averages all source pixels that map to it — simple, no dependencies, good quality for downscaling.

DPI estimation uses a page map built by walking all pages' `Resources → XObject` dicts to find which ref appears on which page size. Conservative approach: uses `Math.min(dpiX, dpiY)` so we never over-downsample.

### Metadata Stripping

Application-private data is surprisingly large. Illustrator's `AIPrivateData` can be hundreds of KB. XMP metadata, `PieceInfo`, Photoshop IRB — all safe to strip without affecting the visual output or user-facing metadata (title, author, subject are preserved separately in `/Info`).

---

## Testing Patterns

### Test Fixture Image Data

**Use sine-wave patterns, not random noise.** Random noise (`Math.random()`) has high entropy that deflates poorly — but it *also* compresses poorly as JPEG. This means the JPEG output can end up *larger* than the deflated random data, causing the size guard to skip the image and making the test meaningless.

Smooth sine-wave patterns (`Math.sin(x * freq)`) are photo-like: they compress poorly with lossless Flate (no exact byte repeats) but excellently with JPEG (smooth gradients). This correctly exercises the "JPEG is smaller" path.

### PDF Number Value Extraction in Tests

When reading numeric values from pdf-lib dicts in tests, `Number(val.toString())` works reliably across all PDFNumber creation methods. The `.numberValue()` / `.value()` accessors return `NaN` or `undefined` in some cases depending on whether the number came from parsing or `context.obj()`.

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

**Decision:** `subset-font` (wraps harfbuzzjs) is the recommended choice. HarfBuzz is used by Chrome, Firefox, and Android — it correctly handles compound glyphs, GSUB/GPOS layout tables, and complex scripts. The ~3.1 MB WASM cost can be mitigated with lazy loading.

**Key trade-off:** `subset-font`'s API is text/Unicode-based (you pass characters to keep), so PDF character codes must be reverse-mapped to Unicode via the font's `/ToUnicode` CMap or `/Encoding`. fontkit's glyph-ID API would be more natural for PDF work, but the library is unmaintained.

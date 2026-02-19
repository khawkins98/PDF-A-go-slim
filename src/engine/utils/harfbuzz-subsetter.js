/**
 * Thin wrapper around harfbuzzjs WASM for font subsetting.
 *
 * Lazily loads the WASM module on first use.
 * Provides a simple API: give it font bytes + Unicode codepoints,
 * get back the subset font bytes.
 *
 * Why we load the WASM binary directly instead of using the harfbuzzjs JS wrapper:
 * The harfbuzzjs npm package sets `module.exports = Promise`, which makes the
 * module itself a "thenable". When ESM `import()` encounters a thenable, it
 * awaits it — but the resolved value is the WASM instance, not the expected
 * JS API. This causes breakage in Vitest and other ESM environments. By loading
 * hb-subset.wasm directly and calling the C API via WebAssembly.instantiate,
 * we bypass the CJS/ESM interop issue entirely.
 *
 * WASM memory lifecycle for each subsetFont() call:
 * 1. malloc() — allocate buffer in WASM linear memory for font bytes
 * 2. Copy font bytes into WASM memory
 * 3. hb_blob_create → hb_face_create — create HarfBuzz font face
 * 4. hb_subset_input_create — configure which codepoints to keep
 * 5. hb_subset_or_fail — produce the subset face
 * 6. hb_face_reference_blob → hb_blob_get_data — extract result bytes
 * 7. Copy result out of WASM memory (memory may have grown during subsetting)
 * 8. finally: destroy blob, face, input; free() the font buffer
 */

const HB_MEMORY_MODE_WRITABLE = 2;
const HB_SUBSET_FLAGS_RETAIN_GIDS = 0x2;

/** @type {any} */
let wasmExports = null;

/**
 * Lazily load the harfbuzzjs subset WASM module.
 * Caches the instance after first load.
 *
 * Node vs browser detection: uses `process.versions?.node` to distinguish
 * environments. In browsers, fetch() loads the WASM from a URL relative to
 * this module. In Node.js (tests), we read the file directly from the
 * harfbuzzjs package using createRequire + require.resolve.
 */
async function getExports() {
  if (wasmExports) return wasmExports;

  // Load the hb-subset.wasm binary directly (we call the C API ourselves,
  // no need for the harfbuzzjs JS wrapper which causes CJS/ESM thenable issues).
  let wasmBinary;
  const isNode = typeof process !== 'undefined' && process.versions?.node;
  if (!isNode && typeof fetch === 'function') {
    // Browser path: fetch the WASM file
    const wasmUrl = new URL('harfbuzzjs/hb-subset.wasm', import.meta.url);
    const response = await fetch(wasmUrl);
    wasmBinary = await response.arrayBuffer();
  } else {
    // Node.js path (tests): read file directly
    const { readFile } = await import('node:fs/promises');
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const wasmPath = require.resolve('harfbuzzjs/hb-subset.wasm');
    wasmBinary = await readFile(wasmPath);
  }

  const { instance } = await WebAssembly.instantiate(wasmBinary);
  wasmExports = instance.exports;
  return wasmExports;
}

/**
 * Subset a font to only include the given Unicode codepoints (or glyph IDs).
 *
 * @param {Uint8Array} fontBytes - The raw font file bytes (TrueType/OpenType)
 * @param {Set<number>|number[]} codepoints - Unicode codepoints (or glyph IDs if useGlyphIds is set)
 * @param {object} [options]
 * @param {boolean} [options.retainGids=false] - Preserve glyph IDs (for CID fonts)
 * @param {boolean} [options.useGlyphIds=false] - Treat codepoints as glyph IDs instead of Unicode
 * @returns {Promise<Uint8Array>} The subset font bytes
 */
export async function subsetFont(fontBytes, codepoints, options = {}) {
  const { retainGids = false, useGlyphIds = false } = options;
  const exports = await getExports();

  // Allocate memory for the font blob
  const fontBuffer = exports.malloc(fontBytes.byteLength);
  const heapu8 = new Uint8Array(exports.memory.buffer);
  heapu8.set(fontBytes, fontBuffer);

  // Create blob → face
  const blob = exports.hb_blob_create(fontBuffer, fontBytes.byteLength, HB_MEMORY_MODE_WRITABLE, 0, 0);
  const face = exports.hb_face_create(blob, 0);
  exports.hb_blob_destroy(blob);

  let input = 0;
  let subset = 0;
  let resultBlob = 0;

  try {
    // Create subset input
    input = exports.hb_subset_input_create_or_fail();
    if (!input) throw new Error('Failed to create subset input');

    // Set flags
    if (retainGids) {
      exports.hb_subset_input_set_flags(input, HB_SUBSET_FLAGS_RETAIN_GIDS);
    }

    // Add codepoints to the appropriate set
    const cpSet = codepoints instanceof Set ? codepoints : new Set(codepoints);

    if (useGlyphIds) {
      // GID-based: populate the glyph set directly (bypasses cmap lookup)
      const glyphSet = exports.hb_subset_input_glyph_set(input);
      for (const gid of cpSet) {
        exports.hb_set_add(glyphSet, gid);
      }
    } else {
      // Unicode-based: harfbuzz uses the font's cmap to resolve GIDs
      const unicodeSet = exports.hb_subset_input_unicode_set(input);
      for (const cp of cpSet) {
        exports.hb_set_add(unicodeSet, cp);
      }
    }

    // Perform subsetting
    subset = exports.hb_subset_or_fail(face, input);
    if (!subset) throw new Error('Subsetting failed');

    // Extract result
    resultBlob = exports.hb_face_reference_blob(subset);
    const dataPtr = exports.hb_blob_get_data(resultBlob, 0);
    const length = exports.hb_blob_get_length(resultBlob);

    // Copy result out of WASM memory (memory may have grown)
    const resultHeap = new Uint8Array(exports.memory.buffer);
    const result = new Uint8Array(length);
    result.set(resultHeap.subarray(dataPtr, dataPtr + length));

    return result;
  } finally {
    // Clean up WASM resources
    if (resultBlob) exports.hb_blob_destroy(resultBlob);
    if (subset) exports.hb_face_destroy(subset);
    if (input) exports.hb_subset_input_destroy(input);
    exports.hb_face_destroy(face);
    exports.free(fontBuffer);
  }
}

/**
 * Font subsetting pass.
 *
 * Strips unused glyph outlines from embedded font programs.
 * For each font, determines which characters are used in the document,
 * maps them to Unicode, and calls harfbuzzjs to produce a minimal subset.
 *
 * Supports:
 * - Type1 / TrueType (simple, 1-byte char codes)
 * - Type0 / CIDFont with Identity-H encoding + Identity CIDToGIDMap
 *
 * Skips:
 * - Type0 with non-Identity CMaps
 * - Type3 fonts
 * - Fonts < 10 KB (not worth subsetting)
 * - Fonts without ToUnicode or recognizable encoding
 *
 * Correctness guards (not configurable — these prevent broken output):
 *
 * 1. Cmap-less CIDFontType2: Already-subsetted Type0 fonts often have their
 *    cmap table stripped. Harfbuzz's Unicode-based subsetting needs cmap to
 *    resolve Unicode→GID; without it, every glyph resolves to .notdef. We
 *    detect this and switch to GID-based subsetting (hb_subset_input_glyph_set),
 *    passing CIDs directly as GIDs since Identity CIDToGIDMap means CID=GID.
 *
 * 2. Already-subsetted simple fonts (ABCDEF+ prefix): These use renumbered
 *    char codes (FirstChar 33+) with cmap-based glyph lookup. Unicode-based
 *    re-subsetting uses a different mapping path, dropping glyphs the PDF
 *    actually needs. Handled upstream in content-stream-parser.js which skips
 *    subset-prefixed simple fonts.
 *
 * These guards are correctness requirements, not trade-offs. Disabling them
 * would produce corrupt text output. See docs/learnings.md for details.
 */
import { PDFName, PDFDict, PDFRef, PDFRawStream, PDFArray } from 'pdf-lib';
import { zlibSync } from 'fflate';
import { extractUsedCharCodes } from '../utils/content-stream-parser.js';
import { charCodesToUnicode, isIdentityHFont } from '../utils/unicode-mapper.js';
import { subsetFont } from '../utils/harfbuzz-subsetter.js';
import { decodeStream, allFiltersDecodable, getFilterNames } from '../utils/stream-decode.js';
import { FONT_FILE_KEYS } from '../utils/hash.js';

/** Minimum font stream size worth subsetting (10 KB). */
const MIN_FONT_SIZE = 10 * 1024;

/**
 * Subset embedded fonts in the document.
 *
 * @param {PDFDocument} pdfDoc
 * @param {object} [options]
 * @param {boolean} [options.subsetFonts=true] - Enable/disable this pass
 * @returns {Promise<{ subsetted: number, skipped: number }>}
 */
export async function subsetFonts(pdfDoc, options = {}) {
  const { subsetFonts: enabled = true } = options;
  if (!enabled) return { subsetted: 0, skipped: 0 };

  const context = pdfDoc.context;

  // Step 1: Extract all used char codes per font from content streams
  let usedCharCodes;
  try {
    usedCharCodes = extractUsedCharCodes(pdfDoc);
  } catch {
    return { subsetted: 0, skipped: 0 };
  }

  if (usedCharCodes.size === 0) return { subsetted: 0, skipped: 0 };

  // Step 2: Build a map of font ref tag → font descriptor + font file info
  const fontInfos = collectFontInfos(context, usedCharCodes);

  let subsetted = 0;
  let skipped = 0;

  // Step 3: Process each font
  for (const info of fontInfos) {
    try {
      const result = await processFont(context, info);
      if (result) {
        subsetted++;
      } else {
        skipped++;
      }
    } catch {
      skipped++;
    }
  }

  return { subsetted, skipped };
}

/**
 * Collect information about each font that has used char codes.
 */
function collectFontInfos(context, usedCharCodes) {
  const infos = [];

  for (const [refTag, { fontDict, charCodes }] of usedCharCodes) {
    if (charCodes.length === 0) continue;

    const fontType = getFontType(fontDict);
    if (!fontType) continue;

    // Find the font descriptor and font file
    const descriptorInfo = findFontFile(context, fontDict);
    if (!descriptorInfo) continue;

    infos.push({
      refTag,
      fontDict,
      charCodes,
      fontType,
      ...descriptorInfo,
    });
  }

  return infos;
}

/**
 * Get the font type: 'simple' for Type1/TrueType, 'type0' for Type0/CIDFont.
 * Returns null for unsupported types.
 */
function getFontType(fontDict) {
  const subtype = fontDict.get(PDFName.of('Subtype'));
  if (!(subtype instanceof PDFName)) return null;

  const name = subtype.decodeText();
  switch (name) {
    case 'Type1':
    case 'TrueType':
      return 'simple';
    case 'Type0':
      return 'type0';
    default:
      return null;
  }
}

/**
 * Find the embedded font file stream for a font dict.
 * Navigates: Font → FontDescriptor → FontFile/FontFile2/FontFile3
 * For Type0, navigates through DescendantFonts.
 */
function findFontFile(context, fontDict) {
  let descriptorRef = fontDict.get(PDFName.of('FontDescriptor'));

  // For Type0, look in DescendantFonts
  if (!descriptorRef) {
    const descendants = fontDict.get(PDFName.of('DescendantFonts'));
    if (descendants instanceof PDFArray && descendants.size() > 0) {
      let cidFont = descendants.get(0);
      if (cidFont instanceof PDFRef) cidFont = context.lookup(cidFont);
      if (cidFont instanceof PDFDict) {
        descriptorRef = cidFont.get(PDFName.of('FontDescriptor'));
      }
    }
  }

  if (!descriptorRef) return null;

  const descriptor = descriptorRef instanceof PDFRef
    ? context.lookup(descriptorRef)
    : descriptorRef;
  if (!(descriptor instanceof PDFDict)) return null;

  for (const key of FONT_FILE_KEYS) {
    const fontFileRef = descriptor.get(PDFName.of(key));
    if (!(fontFileRef instanceof PDFRef)) continue;

    const fontFileObj = context.lookup(fontFileRef);
    if (!(fontFileObj instanceof PDFRawStream)) continue;

    return {
      descriptor,
      fontFileKey: key,
      fontFileRef,
      fontFileStream: fontFileObj,
    };
  }

  return null;
}

/**
 * Check if a TrueType/OpenType font binary has a 'cmap' table.
 * Parses the table directory from the font header.
 */
function fontHasCmap(fontBytes) {
  if (fontBytes.length < 12) return false;
  const view = new DataView(fontBytes.buffer, fontBytes.byteOffset, fontBytes.byteLength);
  const numTables = view.getUint16(4);
  for (let i = 0; i < numTables; i++) {
    const offset = 12 + i * 16;
    if (offset + 4 > fontBytes.length) break;
    const tag = String.fromCharCode(
      fontBytes[offset], fontBytes[offset + 1],
      fontBytes[offset + 2], fontBytes[offset + 3],
    );
    if (tag === 'cmap') return true;
  }
  return false;
}

/**
 * Extract raw CIDs from Type0 char code buffers (2-byte big-endian).
 */
function extractCids(charCodeBuffers) {
  const cids = new Set();
  for (const buf of charCodeBuffers) {
    for (let i = 0; i + 1 < buf.length; i += 2) {
      cids.add((buf[i] << 8) | buf[i + 1]);
    }
  }
  return cids;
}

/**
 * Process a single font: subset it and replace the stream if smaller.
 * Returns true if the font was successfully subsetted and replaced.
 */
async function processFont(context, info) {
  const { fontDict, charCodes, fontType, fontFileStream, fontFileRef, fontFileKey } = info;

  // Decode the font stream
  const filters = getFilterNames(fontFileStream.dict);
  let fontBytes;
  try {
    fontBytes = (filters && allFiltersDecodable(filters))
      ? decodeStream(fontFileStream.contents, filters)
      : fontFileStream.contents;
  } catch {
    return false;
  }

  const originalSize = fontBytes.length;

  // Skip small fonts
  if (originalSize < MIN_FONT_SIZE) return false;

  // Determine if we need retain-gids (for Type0/Identity-H)
  const retainGids = fontType === 'type0' && isIdentityHFont(fontDict, context);

  // Type0 without Identity-H is not supported
  if (fontType === 'type0' && !retainGids) return false;

  // CORRECTNESS GUARD: GID-based subsetting for cmap-less fonts.
  // Already-subsetted CIDFontType2 fonts often lack a cmap table (stripped by
  // the original producer). Harfbuzz's Unicode path needs cmap to resolve
  // Unicode→GID; without it, it produces only .notdef (invisible text).
  // This is not a configurable trade-off — Unicode subsetting *cannot work*
  // without a cmap. We pass CIDs directly as GIDs instead (safe because
  // Identity CIDToGIDMap means CID=GID).
  const hasCmap = fontHasCmap(fontBytes);
  const useGlyphIds = retainGids && !hasCmap;

  let subsetInput;
  if (useGlyphIds) {
    subsetInput = extractCids(charCodes);
  } else {
    subsetInput = charCodesToUnicode(fontDict, charCodes, context);
  }
  if (subsetInput.size === 0) return false;

  // Call harfbuzzjs subsetter
  let subsetBytes;
  try {
    subsetBytes = await subsetFont(fontBytes, subsetInput, { retainGids, useGlyphIds });
  } catch {
    return false;
  }

  if (!subsetBytes || subsetBytes.length === 0) return false;

  // Per-font size guard: only replace if subset is smaller
  if (subsetBytes.length >= originalSize) return false;

  // Recompress with deflate level 9
  const compressed = zlibSync(subsetBytes, { level: 9 });

  // Replace the font stream
  const newStream = PDFRawStream.of(fontFileStream.dict, compressed);
  fontFileStream.dict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
  fontFileStream.dict.delete(PDFName.of('DecodeParms'));
  fontFileStream.dict.set(PDFName.of('Length'), context.obj(compressed.length));

  // Update Length1 (original uncompressed length, required for some font types)
  if (fontFileKey === 'FontFile' || fontFileKey === 'FontFile2') {
    fontFileStream.dict.set(PDFName.of('Length1'), context.obj(subsetBytes.length));
  }

  context.assign(fontFileRef, newStream);

  return true;
}

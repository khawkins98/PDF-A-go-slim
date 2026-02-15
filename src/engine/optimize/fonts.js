/**
 * Font deduplication pass.
 *
 * Identifies font objects with embedded font programs (FontFile, FontFile2,
 * FontFile3). Hashes the font stream contents. If two font descriptors
 * reference identical font programs, keeps one and rewrites all references.
 */
import { PDFDict, PDFArray, PDFRef, PDFName, PDFRawStream } from 'pdf-lib';
import { hashBytes, FONT_FILE_KEYS } from '../utils/hash.js';

/**
 * Deduplicate identical font programs.
 * @param {PDFDocument} pdfDoc
 * @returns {{ deduplicated: number }}
 */
export function deduplicateFonts(pdfDoc) {
  const context = pdfDoc.context;

  // Phase 1: Find all font descriptor → font file stream mappings
  // fontFileRefTag → { hash, canonicalRef }
  const fontFileHashes = new Map(); // hash → canonical font file ref
  const fontFileDuplicates = new Map(); // duplicate ref tag → canonical ref

  for (const [ref, obj] of context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict) || obj instanceof PDFRawStream) continue;

    // Check if this is a font descriptor
    const type = obj.get(PDFName.of('Type'));
    if (!type || !(type instanceof PDFName) || type.decodeText() !== 'FontDescriptor') continue;

    for (const key of FONT_FILE_KEYS) {
      const fontFileRef = obj.get(PDFName.of(key));
      if (!(fontFileRef instanceof PDFRef)) continue;

      const fontFileObj = context.lookup(fontFileRef);
      if (!(fontFileObj instanceof PDFRawStream)) continue;

      const hash = hashBytes(fontFileObj.contents);

      if (fontFileHashes.has(hash)) {
        const canonicalRef = fontFileHashes.get(hash);
        if (canonicalRef.tag !== fontFileRef.tag) {
          fontFileDuplicates.set(fontFileRef.tag, canonicalRef);
          // Rewrite this descriptor to point to the canonical font file
          obj.set(PDFName.of(key), canonicalRef);
        }
      } else {
        fontFileHashes.set(hash, fontFileRef);
      }
    }
  }

  if (fontFileDuplicates.size === 0) return { deduplicated: 0 };

  // Phase 2: Also rewrite any other references to duplicate font files
  for (const [, obj] of context.enumerateIndirectObjects()) {
    if (obj instanceof PDFDict) {
      rewriteFontRefs(obj, fontFileDuplicates);
    } else if (obj instanceof PDFRawStream) {
      rewriteFontRefs(obj.dict, fontFileDuplicates);
    } else if (obj instanceof PDFArray) {
      rewriteFontRefsInArray(obj, fontFileDuplicates);
    }
  }

  // Phase 3: Delete duplicate font file streams
  for (const [dupTag] of fontFileDuplicates) {
    const parts = dupTag.split(' ');
    const ref = PDFRef.of(parseInt(parts[0], 10), parseInt(parts[1], 10));
    context.delete(ref);
  }

  return { deduplicated: fontFileDuplicates.size };
}

function rewriteFontRefs(dict, duplicates) {
  for (const [key, value] of dict.entries()) {
    if (value instanceof PDFRef) {
      const canonical = duplicates.get(value.tag);
      if (canonical) dict.set(key, canonical);
    } else if (value instanceof PDFDict) {
      rewriteFontRefs(value, duplicates);
    } else if (value instanceof PDFArray) {
      rewriteFontRefsInArray(value, duplicates);
    }
  }
}

function rewriteFontRefsInArray(arr, duplicates) {
  for (let i = 0; i < arr.size(); i++) {
    const value = arr.get(i);
    if (value instanceof PDFRef) {
      const canonical = duplicates.get(value.tag);
      if (canonical) arr.set(i, canonical);
    } else if (value instanceof PDFDict) {
      rewriteFontRefs(value, duplicates);
    } else if (value instanceof PDFArray) {
      rewriteFontRefsInArray(value, duplicates);
    }
  }
}

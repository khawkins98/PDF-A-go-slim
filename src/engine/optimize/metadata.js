/**
 * Metadata stripping pass.
 *
 * Removes:
 *   - XMP metadata stream from catalog
 *   - PieceInfo from pages
 *   - Thumb (thumbnails) from pages
 *   - AIPrivateData, Photoshop, Illustrator entries from all dicts
 *
 * Preserves:
 *   - /Info dictionary (title, author, subject, keywords)
 */
import { PDFDict, PDFName, PDFArray, PDFRef, PDFRawStream } from 'pdf-lib';

/** Keys to strip from all dicts. */
const BLOAT_KEYS = [
  'PieceInfo',
  'Thumb',
  'AIPrivateData1',
  'AIPrivateData2',
  'AIPrivateData3',
  'AIPrivateData4',
  'AIMetaData',
  'Photoshop',
  'IRB',
];

/**
 * Strip metadata bloat from the document.
 * @param {PDFDocument} pdfDoc
 * @returns {{ stripped: number }}
 */
export function stripMetadata(pdfDoc) {
  const context = pdfDoc.context;
  let stripped = 0;

  // 1. Remove XMP metadata stream from the catalog
  const catalog = pdfDoc.catalog;
  const metadataRef = catalog.get(PDFName.of('Metadata'));
  if (metadataRef) {
    catalog.delete(PDFName.of('Metadata'));
    // Delete the metadata stream object itself if it's an indirect ref
    if (metadataRef instanceof PDFRef) {
      context.delete(metadataRef);
    }
    stripped++;
  }

  // 2. Walk all indirect objects and strip bloat keys
  for (const [, obj] of context.enumerateIndirectObjects()) {
    if (obj instanceof PDFDict) {
      stripped += stripBloatFromDict(obj);
    } else if (obj instanceof PDFRawStream) {
      stripped += stripBloatFromDict(obj.dict);
    }
  }

  return { stripped };
}

/**
 * Remove bloat keys from a single dict.
 */
function stripBloatFromDict(dict) {
  let count = 0;
  for (const key of BLOAT_KEYS) {
    const pdfKey = PDFName.of(key);
    if (dict.get(pdfKey)) {
      dict.delete(pdfKey);
      count++;
    }
  }
  return count;
}

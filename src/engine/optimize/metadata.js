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
import { PDFDict, PDFName, PDFArray, PDFRef, PDFRawStream, PDFString } from 'pdf-lib';

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
    // Before stripping, migrate document language to /Lang on catalog
    // (screen readers and assistive tech depend on /Lang)
    if (!catalog.get(PDFName.of('Lang')) && metadataRef instanceof PDFRef) {
      const metadataObj = context.lookup(metadataRef);
      if (metadataObj instanceof PDFRawStream) {
        const lang = extractLangFromXmp(metadataObj.contents);
        if (lang) {
          catalog.set(PDFName.of('Lang'), PDFString.of(lang));
        }
      }
    }

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
 * Extract the document language from XMP metadata bytes.
 * Handles common XMP patterns: <dc:language><rdf:Bag><rdf:li>en</rdf:li>...
 * and xml:lang="en" on rdf:Description.
 * @param {Uint8Array} xmpBytes
 * @returns {string|null}
 */
function extractLangFromXmp(xmpBytes) {
  try {
    const xml = new TextDecoder().decode(xmpBytes);
    // Try dc:language first (most common for document-level language)
    const dcLangMatch = xml.match(
      /<dc:language[\s\S]*?<rdf:li[^>]*>\s*([a-zA-Z]{2,3}(?:-[a-zA-Z0-9-]+)?)\s*<\/rdf:li>/,
    );
    if (dcLangMatch) return dcLangMatch[1];
    // Fallback: xml:lang on rdf:Description
    const xmlLangMatch = xml.match(/xml:lang="([a-zA-Z]{2,3}(?:-[a-zA-Z0-9-]+)?)"/);
    if (xmlLangMatch && xmlLangMatch[1] !== 'x-default') return xmlLangMatch[1];
    return null;
  } catch {
    return null;
  }
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

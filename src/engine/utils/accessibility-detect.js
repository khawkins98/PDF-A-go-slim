/**
 * Accessibility and conformance detection utilities.
 *
 * Detects PDF/A conformance, tagged PDF structure, and PDF/UA from
 * the document catalog and XMP metadata. Used by the pipeline to
 * auto-disable passes that would break conformance.
 */
import { PDFName, PDFRef, PDFRawStream, PDFDict } from 'pdf-lib';

/**
 * Parse PDF/A and PDF/UA conformance levels from XMP metadata bytes.
 *
 * Handles both element-style and attribute-style XMP:
 *   Element: <pdfaid:part>1</pdfaid:part> <pdfaid:conformance>B</pdfaid:conformance>
 *   Attribute: <rdf:Description pdfaid:part="1" pdfaid:conformance="B" ...>
 *
 * @param {Uint8Array} xmpBytes
 * @returns {{ pdfAPart: string|null, pdfAConformance: string|null, pdfUAPart: string|null }}
 */
export function parseConformanceFromXmp(xmpBytes) {
  let xml;
  try {
    xml = new TextDecoder().decode(xmpBytes);
  } catch {
    return { pdfAPart: null, pdfAConformance: null, pdfUAPart: null };
  }

  // PDF/A part — element or attribute style
  const pdfAPart =
    xml.match(/<pdfaid:part[^>]*>\s*(\d+)\s*<\/pdfaid:part>/)?.[1] ??
    xml.match(/pdfaid:part="(\d+)"/)?.[1] ??
    null;

  // PDF/A conformance level — element or attribute style
  const pdfAConformance =
    xml.match(/<pdfaid:conformance[^>]*>\s*([A-Za-z]+)\s*<\/pdfaid:conformance>/)?.[1] ??
    xml.match(/pdfaid:conformance="([A-Za-z]+)"/)?.[1] ??
    null;

  // PDF/UA part — element or attribute style
  const pdfUAPart =
    xml.match(/<pdfuaid:part[^>]*>\s*(\d+)\s*<\/pdfuaid:part>/)?.[1] ??
    xml.match(/pdfuaid:part="(\d+)"/)?.[1] ??
    null;

  return { pdfAPart, pdfAConformance, pdfUAPart };
}

/**
 * Detect accessibility-related traits from a loaded PDFDocument.
 *
 * @param {PDFDocument} pdfDoc
 * @returns {{ isTagged: boolean, isPdfA: boolean, pdfALevel: string|null, isPdfUA: boolean, hasStructTree: boolean, lang: string|null }}
 */
export function detectAccessibilityTraits(pdfDoc) {
  const catalog = pdfDoc.catalog;

  // Check /MarkInfo << /Marked true >>
  let isTagged = false;
  const markInfo = catalog.get(PDFName.of('MarkInfo'));
  if (markInfo) {
    const resolved = markInfo instanceof PDFRef
      ? pdfDoc.context.lookup(markInfo)
      : markInfo;
    if (resolved instanceof PDFDict) {
      const marked = resolved.get(PDFName.of('Marked'));
      if (marked && marked.toString() === 'true') {
        isTagged = true;
      }
    }
  }

  // Check /StructTreeRoot
  const hasStructTree = !!catalog.get(PDFName.of('StructTreeRoot'));

  // Check /Lang
  const langObj = catalog.get(PDFName.of('Lang'));
  const lang = langObj ? langObj.decodeText() : null;

  // Check XMP for PDF/A and PDF/UA
  let isPdfA = false;
  let pdfALevel = null;
  let isPdfUA = false;

  const metadataRef = catalog.get(PDFName.of('Metadata'));
  if (metadataRef) {
    const metadataObj = metadataRef instanceof PDFRef
      ? pdfDoc.context.lookup(metadataRef)
      : metadataRef;
    if (metadataObj instanceof PDFRawStream) {
      const { pdfAPart, pdfAConformance, pdfUAPart } =
        parseConformanceFromXmp(metadataObj.contents);

      if (pdfAPart) {
        isPdfA = true;
        pdfALevel = `${pdfAPart}${pdfAConformance ? pdfAConformance.toUpperCase() : ''}`;
      }
      if (pdfUAPart) {
        isPdfUA = true;
      }
    }
  }

  return { isTagged, isPdfA, pdfALevel, isPdfUA, hasStructTree, lang };
}

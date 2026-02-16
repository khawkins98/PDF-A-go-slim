/**
 * Accessibility and conformance detection utilities.
 *
 * Detects PDF/A conformance, tagged PDF structure, and PDF/UA from
 * the document catalog and XMP metadata. Used by the pipeline to
 * auto-disable passes that would break conformance.
 */
import { PDFName, PDFRef, PDFRawStream, PDFDict, PDFArray, PDFStream } from 'pdf-lib';

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

/**
 * Resolve a value through PDFRefs to the underlying object.
 * @param {*} val
 * @param {import('pdf-lib').PDFContext} context
 * @returns {*}
 */
function resolve(val, context) {
  return val instanceof PDFRef ? context.lookup(val) : val;
}

/**
 * Audit ToUnicode CMap coverage across all fonts in the document.
 *
 * Enumerates indirect objects with Type: Font. Skips Type3 fonts and
 * CIDFont descendants (they're counted via their Type0 parent).
 *
 * @param {import('pdf-lib').PDFDocument} pdfDoc
 * @returns {{ total: number, withToUnicode: number, fonts: Array<{ name: string, hasToUnicode: boolean }> }}
 */
function auditToUnicodeCoverage(pdfDoc) {
  const fonts = [];
  const context = pdfDoc.context;

  context.enumerateIndirectObjects().forEach(([, obj]) => {
    if (!(obj instanceof PDFDict)) return;
    const type = obj.get(PDFName.of('Type'));
    if (!type || type.toString() !== '/Font') return;

    const subtype = obj.get(PDFName.of('Subtype'));
    const subtypeStr = subtype ? subtype.toString() : '';

    // Skip Type3 fonts and CIDFont descendants (counted via Type0 parent)
    if (subtypeStr === '/Type3' || subtypeStr === '/CIDFontType0' || subtypeStr === '/CIDFontType2') return;

    const baseFont = obj.get(PDFName.of('BaseFont'));
    const name = baseFont ? baseFont.toString().replace(/^\//, '') : 'Unknown';
    const hasToUnicode = !!obj.get(PDFName.of('ToUnicode'));

    fonts.push({ name, hasToUnicode });
  });

  return {
    total: fonts.length,
    withToUnicode: fonts.filter(f => f.hasToUnicode).length,
    fonts,
  };
}

/**
 * Audit image alt text coverage via StructElem /Figure elements.
 *
 * Counts image XObjects (Subtype: Image), then walks StructElem objects
 * with /S /Figure and checks for /Alt.
 *
 * @param {import('pdf-lib').PDFDocument} pdfDoc
 * @returns {{ totalImages: number, figures: { total: number, withAlt: number, withoutAlt: number } | null }}
 */
function auditImageAltText(pdfDoc) {
  const context = pdfDoc.context;

  // Count image XObjects
  let totalImages = 0;
  context.enumerateIndirectObjects().forEach(([, obj]) => {
    if (obj instanceof PDFStream) {
      const dict = obj instanceof PDFDict ? obj : obj.dict;
      if (!dict) return;
      const subtype = dict.get(PDFName.of('Subtype'));
      if (subtype && subtype.toString() === '/Image') totalImages++;
    }
  });

  // Check for StructTreeRoot
  const catalog = pdfDoc.catalog;
  const structTreeRootRef = catalog.get(PDFName.of('StructTreeRoot'));
  if (!structTreeRootRef) {
    return { totalImages, figures: null };
  }

  // Walk StructElem objects looking for /S /Figure
  let total = 0;
  let withAlt = 0;

  context.enumerateIndirectObjects().forEach(([, obj]) => {
    if (!(obj instanceof PDFDict)) return;
    const type = obj.get(PDFName.of('Type'));
    if (type && type.toString() !== '/StructElem') return;

    const s = obj.get(PDFName.of('S'));
    if (!s || s.toString() !== '/Figure') return;

    total++;
    if (obj.get(PDFName.of('Alt'))) withAlt++;
  });

  return {
    totalImages,
    figures: { total, withAlt, withoutAlt: total - withAlt },
  };
}

/**
 * Audit structure tree depth and element types.
 *
 * Recursive walk from /StructTreeRoot through /K children, counting elements,
 * collecting /S types, tracking max depth. Uses a visited Set to prevent cycles.
 * Caps at depth 200.
 *
 * @param {import('pdf-lib').PDFDocument} pdfDoc
 * @returns {{ elementCount: number, elementTypes: string[], maxDepth: number } | null}
 */
function auditStructureTree(pdfDoc) {
  const catalog = pdfDoc.catalog;
  const context = pdfDoc.context;
  const structTreeRootRef = catalog.get(PDFName.of('StructTreeRoot'));
  if (!structTreeRootRef) return null;

  const structTreeRoot = resolve(structTreeRootRef, context);
  if (!(structTreeRoot instanceof PDFDict)) return null;

  const visited = new Set();
  const typeSet = new Set();
  let elementCount = 0;
  let maxDepth = 0;

  function walk(node, depth) {
    if (depth > 200) return;
    if (maxDepth < depth) maxDepth = depth;

    const resolved = resolve(node, context);
    if (!resolved) return;

    // Track visited refs to prevent cycles
    if (node instanceof PDFRef) {
      const tag = node.toString();
      if (visited.has(tag)) return;
      visited.add(tag);
    }

    if (resolved instanceof PDFDict) {
      const s = resolved.get(PDFName.of('S'));
      if (s) {
        elementCount++;
        typeSet.add(s.toString().replace(/^\//, ''));
      }

      const k = resolved.get(PDFName.of('K'));
      if (k) {
        const kResolved = resolve(k, context);
        if (kResolved instanceof PDFArray) {
          for (let i = 0; i < kResolved.size(); i++) {
            walk(kResolved.get(i), depth + 1);
          }
        } else if (kResolved instanceof PDFDict || kResolved instanceof PDFRef) {
          walk(kResolved, depth + 1);
        }
      }
    }
  }

  // Start from StructTreeRoot's /K
  const rootK = structTreeRoot.get(PDFName.of('K'));
  if (rootK) {
    const rootKResolved = resolve(rootK, context);
    if (rootKResolved instanceof PDFArray) {
      for (let i = 0; i < rootKResolved.size(); i++) {
        walk(rootKResolved.get(i), 1);
      }
    } else {
      walk(rootK, 1);
    }
  }

  return {
    elementCount,
    elementTypes: [...typeSet].sort(),
    maxDepth,
  };
}

/**
 * Run lightweight accessibility audits on a PDFDocument.
 *
 * @param {import('pdf-lib').PDFDocument} pdfDoc
 * @returns {{ toUnicode: object, imageAlt: object, structureTree: object | null }}
 */
export function auditAccessibility(pdfDoc) {
  return {
    toUnicode: auditToUnicodeCoverage(pdfDoc),
    imageAlt: auditImageAltText(pdfDoc),
    structureTree: auditStructureTree(pdfDoc),
  };
}

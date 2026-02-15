/**
 * Verification helpers for inspecting optimized PDFs.
 *
 * Pure functions that examine a loaded PDFDocument and return structured results.
 * Used by benchmark tests to assert output state after optimization.
 */
import { PDFName, PDFDict, PDFArray, PDFRef, PDFRawStream, PDFString } from 'pdf-lib';
import { FONT_FILE_KEYS } from '../../src/engine/utils/hash.js';

/**
 * Get all embedded fonts from the document.
 * Walks all /Type /Font dicts, resolves FontDescriptor, checks for FontFile/FontFile2/FontFile3.
 *
 * @param {import('pdf-lib').PDFDocument} pdfDoc
 * @returns {Array<{ name: string, subtype: string|null, hasDescriptor: boolean, hasFontFile: boolean, fontFileKey: string|null }>}
 */
export function getEmbeddedFonts(pdfDoc) {
  const context = pdfDoc.context;
  const fonts = [];

  for (const [, obj] of context.enumerateIndirectObjects()) {
    const dict = obj instanceof PDFRawStream ? obj.dict : obj instanceof PDFDict ? obj : null;
    if (!dict) continue;

    const type = dict.get(PDFName.of('Type'));
    if (!(type instanceof PDFName) || type.decodeText() !== 'Font') continue;

    const baseFont = dict.get(PDFName.of('BaseFont'));
    let name = baseFont instanceof PDFName ? baseFont.decodeText() : null;
    // Strip subset prefix (e.g., ABCDEF+Helvetica → Helvetica)
    if (name) name = name.replace(/^[A-Z]{6}\+/, '');

    const subtypeVal = dict.get(PDFName.of('Subtype'));
    const subtype = subtypeVal instanceof PDFName ? subtypeVal.decodeText() : null;

    let hasDescriptor = false;
    let hasFontFile = false;
    let fontFileKey = null;

    const descriptorRef = dict.get(PDFName.of('FontDescriptor'));
    if (descriptorRef) {
      const descriptor = descriptorRef instanceof PDFRef
        ? context.lookup(descriptorRef)
        : descriptorRef;
      if (descriptor instanceof PDFDict) {
        hasDescriptor = true;
        for (const key of FONT_FILE_KEYS) {
          const val = descriptor.get(PDFName.of(key));
          if (val) {
            hasFontFile = true;
            fontFileKey = key;
            break;
          }
        }
      }
    }

    fonts.push({ name, subtype, hasDescriptor, hasFontFile, fontFileKey });
  }

  return fonts;
}

/**
 * Get metadata status of the document.
 *
 * @param {import('pdf-lib').PDFDocument} pdfDoc
 * @returns {{ hasXmp: boolean, hasPieceInfo: boolean, hasThumbnails: boolean, bloatKeyCount: number }}
 */
export function getMetadataStatus(pdfDoc) {
  const context = pdfDoc.context;
  const catalog = pdfDoc.catalog;

  const hasXmp = !!catalog.get(PDFName.of('Metadata'));

  const BLOAT_KEYS = [
    'PieceInfo', 'Thumb', 'AIPrivateData1', 'AIPrivateData2',
    'AIPrivateData3', 'AIPrivateData4', 'AIMetaData', 'Photoshop', 'IRB',
  ];

  let hasPieceInfo = false;
  let hasThumbnails = false;
  let bloatKeyCount = 0;

  for (const [, obj] of context.enumerateIndirectObjects()) {
    const dict = obj instanceof PDFRawStream ? obj.dict : obj instanceof PDFDict ? obj : null;
    if (!dict) continue;

    for (const key of BLOAT_KEYS) {
      if (dict.get(PDFName.of(key))) {
        bloatKeyCount++;
        if (key === 'PieceInfo') hasPieceInfo = true;
        if (key === 'Thumb') hasThumbnails = true;
      }
    }
  }

  return { hasXmp, hasPieceInfo, hasThumbnails, bloatKeyCount };
}

/**
 * Get structure tree information from the document.
 *
 * @param {import('pdf-lib').PDFDocument} pdfDoc
 * @returns {{ hasStructTree: boolean, hasMarkInfo: boolean, isMarked: boolean, lang: string|null, structElemCount: number, structElemTypes: string[] }}
 */
export function getStructureTreeInfo(pdfDoc) {
  const context = pdfDoc.context;
  const catalog = pdfDoc.catalog;

  const structTreeRef = catalog.get(PDFName.of('StructTreeRoot'));
  const hasStructTree = !!structTreeRef;

  const markInfoVal = catalog.get(PDFName.of('MarkInfo'));
  let hasMarkInfo = false;
  let isMarked = false;
  if (markInfoVal) {
    hasMarkInfo = true;
    const markInfo = markInfoVal instanceof PDFRef ? context.lookup(markInfoVal) : markInfoVal;
    if (markInfo instanceof PDFDict) {
      const marked = markInfo.get(PDFName.of('Marked'));
      if (marked) {
        const str = marked.toString();
        isMarked = str === 'true';
      }
    }
  }

  const langVal = catalog.get(PDFName.of('Lang'));
  let lang = null;
  if (langVal instanceof PDFString) {
    lang = langVal.decodeText();
  } else if (langVal) {
    lang = langVal.toString().replace(/^\(|\)$/g, '');
  }

  // Walk structure tree counting StructElems and collecting types
  let structElemCount = 0;
  const structElemTypes = new Set();

  if (hasStructTree) {
    for (const [, obj] of context.enumerateIndirectObjects()) {
      const dict = obj instanceof PDFRawStream ? obj.dict : obj instanceof PDFDict ? obj : null;
      if (!dict) continue;

      const type = dict.get(PDFName.of('Type'));
      if (type instanceof PDFName && type.decodeText() === 'StructElem') {
        structElemCount++;
        const s = dict.get(PDFName.of('S'));
        if (s instanceof PDFName) {
          structElemTypes.add(s.decodeText());
        }
      }
    }
  }

  return {
    hasStructTree,
    hasMarkInfo,
    isMarked,
    lang,
    structElemCount,
    structElemTypes: [...structElemTypes].sort(),
  };
}

/**
 * Get document geometry (page count and dimensions).
 *
 * @param {import('pdf-lib').PDFDocument} pdfDoc
 * @returns {{ pageCount: number, pages: Array<{ width: number, height: number }> }}
 */
export function getDocumentGeometry(pdfDoc) {
  const pages = pdfDoc.getPages();
  return {
    pageCount: pages.length,
    pages: pages.map((p) => {
      const { width, height } = p.getSize();
      return { width, height };
    }),
  };
}

/**
 * Get information about all image XObjects in the document.
 *
 * @param {import('pdf-lib').PDFDocument} pdfDoc
 * @returns {Array<{ width: number, height: number, colorSpace: string|null, filter: string|null, size: number }>}
 */
export function getImageInfo(pdfDoc) {
  const context = pdfDoc.context;
  const images = [];

  for (const [, obj] of context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;

    const subtype = obj.dict.get(PDFName.of('Subtype'));
    if (!(subtype instanceof PDFName) || subtype.decodeText() !== 'Image') continue;

    const widthVal = obj.dict.get(PDFName.of('Width'));
    const heightVal = obj.dict.get(PDFName.of('Height'));
    const width = widthVal ? Number(widthVal.toString()) : 0;
    const height = heightVal ? Number(heightVal.toString()) : 0;

    const csVal = obj.dict.get(PDFName.of('ColorSpace'));
    const colorSpace = csVal instanceof PDFName ? csVal.decodeText() : null;

    const filterVal = obj.dict.get(PDFName.of('Filter'));
    const filter = filterVal instanceof PDFName ? filterVal.decodeText() : null;

    images.push({
      width,
      height,
      colorSpace,
      filter,
      size: obj.contents.length,
    });
  }

  return images;
}

/**
 * Get color space information from all pages.
 * Walks each page's Resources/ColorSpace dict and reports entries.
 *
 * @param {import('pdf-lib').PDFDocument} pdfDoc
 * @returns {Array<{ page: number, name: string, type: string }>}
 */
export function getColorSpaceInfo(pdfDoc) {
  const context = pdfDoc.context;
  const pages = pdfDoc.getPages();
  const result = [];

  for (let i = 0; i < pages.length; i++) {
    const pageNode = pages[i].node;
    const resourcesVal = pageNode.get(PDFName.of('Resources'));
    const resources = resourcesVal instanceof PDFRef
      ? context.lookup(resourcesVal)
      : resourcesVal;
    if (!(resources instanceof PDFDict)) continue;

    const csVal = resources.get(PDFName.of('ColorSpace'));
    const csDict = csVal instanceof PDFRef ? context.lookup(csVal) : csVal;
    if (!(csDict instanceof PDFDict)) continue;

    for (const [key, value] of csDict.entries()) {
      const csName = key instanceof PDFName ? key.decodeText() : key.toString();

      // Color space value can be a PDFName (simple) or PDFArray ([/CalRGB <<...>>])
      let csType = null;
      const resolved = value instanceof PDFRef ? context.lookup(value) : value;

      if (resolved instanceof PDFName) {
        csType = resolved.decodeText();
      } else if (resolved instanceof PDFArray && resolved.size() > 0) {
        const first = resolved.get(0);
        if (first instanceof PDFName) {
          csType = first.decodeText();
        }
      }

      result.push({ page: i + 1, name: csName, type: csType });
    }
  }

  return result;
}

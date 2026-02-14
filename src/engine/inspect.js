/**
 * Object Inspector — classifies PDF objects by semantic type and size.
 *
 * Enumerates all indirect objects, groups them into 6 categories
 * (Fonts, Images, Content Streams, Metadata, Page Tree, Other),
 * and returns a plain serializable summary suitable for UI display.
 */
import { PDFName, PDFDict, PDFArray, PDFRef, PDFRawStream } from 'pdf-lib';
import { getFilterNames } from './utils/stream-decode.js';
import { FONT_FILE_KEYS } from './utils/hash.js';

const CATEGORY_LABELS = [
  'Fonts',
  'Images',
  'Content Streams',
  'Metadata',
  'Page Tree',
  'Other',
];

/**
 * Inspect a PDFDocument and return a categorized object summary.
 *
 * @param {import('pdf-lib').PDFDocument} pdfDoc
 * @returns {{ totalSize: number, objectCount: number, categories: Array }}
 */
export function inspectDocument(pdfDoc) {
  const context = pdfDoc.context;
  const pages = pdfDoc.getPages();

  // --- Pre-pass 1: content stream refs → page number ---
  const contentStreamRefs = new Map(); // ref tag → page number (1-based)
  for (let i = 0; i < pages.length; i++) {
    const contentsEntry = pages[i].node.get(PDFName.of('Contents'));
    if (!contentsEntry) continue;
    if (contentsEntry instanceof PDFRef) {
      contentStreamRefs.set(contentsEntry.tag, i + 1);
    } else if (contentsEntry instanceof PDFArray) {
      for (let j = 0; j < contentsEntry.size(); j++) {
        const item = contentsEntry.get(j);
        if (item instanceof PDFRef) {
          contentStreamRefs.set(item.tag, i + 1);
        }
      }
    }
  }

  // --- Pre-pass 2: font file stream refs ---
  const fontFileRefs = new Set(); // ref tags of FontFile/FontFile2/FontFile3 streams
  for (const [, obj] of context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict) || obj instanceof PDFRawStream) continue;
    const type = obj.get(PDFName.of('Type'));
    if (!(type instanceof PDFName) || type.decodeText() !== 'FontDescriptor') continue;
    for (const key of FONT_FILE_KEYS) {
      const val = obj.get(PDFName.of(key));
      if (val instanceof PDFRef) {
        fontFileRefs.add(val.tag);
      }
    }
  }

  // --- Pre-pass 3: image resource names ---
  const imageRefNames = new Map(); // ref tag → resource name (e.g. "Img0")
  for (const page of pages) {
    let resources = page.node.get(PDFName.of('Resources'));
    if (resources instanceof PDFRef) resources = context.lookup(resources);
    if (!(resources instanceof PDFDict)) continue;
    let xobjects = resources.get(PDFName.of('XObject'));
    if (xobjects instanceof PDFRef) xobjects = context.lookup(xobjects);
    if (!(xobjects instanceof PDFDict)) continue;
    for (const [key, value] of xobjects.entries()) {
      if (value instanceof PDFRef) {
        const name = key instanceof PDFName ? key.decodeText() : key.toString();
        imageRefNames.set(value.tag, name);
      }
    }
  }

  // --- Main enumeration ---
  const categories = CATEGORY_LABELS.map((label) => ({
    label,
    totalSize: 0,
    count: 0,
    items: [],
  }));
  const catIndex = Object.fromEntries(CATEGORY_LABELS.map((l, i) => [l, i]));

  let totalSize = 0;
  let objectCount = 0;

  for (const [ref, obj] of context.enumerateIndirectObjects()) {
    objectCount++;
    const isStream = obj instanceof PDFRawStream;
    const dict = isStream ? obj.dict : obj instanceof PDFDict ? obj : null;
    const size = isStream ? obj.contents.length : 0;
    totalSize += size;

    const tag = ref.tag;
    const filters = dict ? getFilterNames(dict) : null;
    const filterStr = filters ? filters.join(', ') : null;

    // Helper to read PDFName values from dict
    const nameVal = (key) => {
      if (!dict) return null;
      const v = dict.get(PDFName.of(key));
      return v instanceof PDFName ? v.decodeText() : null;
    };
    const numVal = (key) => {
      if (!dict) return null;
      const v = dict.get(PDFName.of(key));
      if (v == null) return null;
      if (typeof v.numberValue === 'function') return v.numberValue();
      if (typeof v.value === 'function') return v.value();
      if (v.numberValue !== undefined) return v.numberValue;
      if (v.value !== undefined) return Number(v.value);
      return null;
    };

    const type = nameVal('Type');
    const subtype = nameVal('Subtype');

    let category;
    let name = null;
    let detail = null;

    if (isStream && subtype === 'Image') {
      category = 'Images';
      name = imageRefNames.get(tag) || null;
      const w = numVal('Width');
      const h = numVal('Height');
      const cs = nameVal('ColorSpace');
      if (w != null && h != null) {
        detail = `${w}x${h}${cs ? ' ' + cs : ''}`;
      }
    } else if (isStream && (type === 'Metadata' || subtype === 'XML')) {
      category = 'Metadata';
    } else if (fontFileRefs.has(tag)) {
      category = 'Fonts';
      // Determine which font file key this is
      detail = 'font file';
    } else if (type === 'Font') {
      category = 'Fonts';
      name = nameVal('BaseFont');
      detail = subtype || null;
    } else if (type === 'FontDescriptor') {
      category = 'Fonts';
      name = nameVal('FontName');
      detail = 'FontDescriptor';
    } else if (contentStreamRefs.has(tag)) {
      category = 'Content Streams';
      name = `Page ${contentStreamRefs.get(tag)}`;
    } else if (type === 'Page' || type === 'Pages' || type === 'Catalog') {
      category = 'Page Tree';
      detail = type;
    } else {
      category = 'Other';
      if (isStream) {
        detail = 'stream';
      } else if (dict) {
        // Try to identify common untyped dict objects
        if (dict.get(PDFName.of('Widths'))) detail = 'glyph widths';
        else if (dict.get(PDFName.of('Differences'))) detail = 'encoding';
        else if (dict.get(PDFName.of('Registry'))) detail = 'CID info';
        else if (type) detail = type;
        else detail = 'dict';
      }
    }

    const cat = categories[catIndex[category]];
    cat.count++;
    cat.totalSize += size;
    cat.items.push({
      ref: tag,
      name,
      size,
      filter: filterStr,
      detail,
    });
  }

  return { totalSize, objectCount, categories };
}

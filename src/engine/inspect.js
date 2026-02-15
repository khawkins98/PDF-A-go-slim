/**
 * Object Inspector — classifies PDF objects by semantic type and size.
 *
 * Enumerates all indirect objects, groups them into 6 categories
 * (Fonts, Images, Page Content, Metadata, Document Structure, Other Data),
 * and returns a plain serializable summary suitable for UI display.
 */
import { PDFName, PDFDict, PDFArray, PDFRef, PDFRawStream } from 'pdf-lib';
import { getFilterNames } from './utils/stream-decode.js';
import { FONT_FILE_KEYS } from './utils/hash.js';

const CATEGORY_LABELS = [
  'Fonts',
  'Images',
  'Page Content',
  'Metadata',
  'Document Structure',
  'Other Data',
];

/** Strip ABCDEF+ subset prefix from font names. */
function stripSubsetPrefix(name) {
  if (!name) return name;
  return name.replace(/^[A-Z]{6}\+/, '');
}

/** Map PDF colorspace names to short labels. */
const COLORSPACE_SHORT = {
  DeviceRGB: 'RGB',
  DeviceGray: 'Gray',
  DeviceCMYK: 'CMYK',
};

/** Map font subtype names to readable labels. */
const FONT_SUBTYPE_LABELS = {
  Type1: 'Type 1',
  TrueType: 'TrueType',
  Type0: 'Composite',
  CIDFontType0: 'CID Type 0',
  CIDFontType2: 'CID TrueType',
  Type3: 'Type 3',
  MMType1: 'Multiple Master',
};

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
    let displayName = null;
    let subCategory = null;

    if (isStream && subtype === 'Image') {
      category = 'Images';
      name = imageRefNames.get(tag) || null;
      const w = numVal('Width');
      const h = numVal('Height');
      const cs = nameVal('ColorSpace');
      if (w != null && h != null) {
        const csShort = COLORSPACE_SHORT[cs] || cs || '';
        detail = `${w}x${h}${cs ? ' ' + cs : ''}`;
        displayName = `${w} \u00d7 ${h}${csShort ? ' ' + csShort : ''}`;
      }
    } else if (isStream && (type === 'Metadata' || subtype === 'XML')) {
      category = 'Metadata';
      displayName = 'XMP Metadata';
    } else if (fontFileRefs.has(tag)) {
      category = 'Fonts';
      detail = 'font file';
      displayName = 'Font program data';
    } else if (type === 'Font') {
      category = 'Fonts';
      name = nameVal('BaseFont');
      detail = subtype || null;
      const cleanName = stripSubsetPrefix(name);
      const subtypeLabel = FONT_SUBTYPE_LABELS[subtype] || subtype || '';
      displayName = cleanName ? `${cleanName}${subtypeLabel ? ' (' + subtypeLabel + ')' : ''}` : subtypeLabel;
    } else if (type === 'FontDescriptor') {
      category = 'Fonts';
      name = nameVal('FontName');
      detail = 'FontDescriptor';
      displayName = `${stripSubsetPrefix(name) || 'Font'} descriptor`;
    } else if (contentStreamRefs.has(tag)) {
      category = 'Page Content';
      name = `Page ${contentStreamRefs.get(tag)}`;
      displayName = name;
    } else if (type === 'Page' || type === 'Pages' || type === 'Catalog') {
      category = 'Document Structure';
      detail = type;
      displayName = type === 'Pages' ? 'Page tree node' : type;
    } else {
      category = 'Other Data';

      // Sub-categorize "Other" items
      if (isStream && subtype === 'Form') {
        subCategory = 'Graphics';
        displayName = 'Form XObject';
        detail = 'Form XObject';
      } else if (dict && dict.get(PDFName.of('N')) && dict.get(PDFName.of('Alternate'))) {
        subCategory = 'Color Profiles';
        displayName = 'ICC Color Profile';
        detail = 'ICC profile';
      } else if (dict && dict.get(PDFName.of('CMapName'))) {
        subCategory = 'Font Support';
        displayName = 'Unicode Mapping';
        detail = 'CMap';
      } else if (dict && dict.get(PDFName.of('Differences'))) {
        subCategory = 'Font Support';
        displayName = 'Font Encoding';
        detail = 'encoding';
      } else if (dict && dict.get(PDFName.of('Widths'))) {
        subCategory = 'Font Support';
        displayName = 'Glyph Widths';
        detail = 'glyph widths';
      } else if (type === 'Annot' || subtype === 'Link' || subtype === 'Widget') {
        subCategory = 'Annotations';
        const annLabel = subtype || 'Annotation';
        displayName = `${annLabel} Annotation`;
        detail = annLabel;
      } else if (dict && dict.get(PDFName.of('Registry'))) {
        subCategory = 'Font Support';
        displayName = 'CID Info';
        detail = 'CID info';
      } else if (isStream) {
        subCategory = 'Miscellaneous';
        displayName = 'Data stream';
        detail = 'stream';
      } else if (dict) {
        subCategory = 'Miscellaneous';
        if (type) {
          displayName = type;
          detail = type;
        } else {
          displayName = 'Structure data';
          detail = 'dict';
        }
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
      displayName,
      subCategory,
    });
  }

  return { totalSize, objectCount, categories };
}

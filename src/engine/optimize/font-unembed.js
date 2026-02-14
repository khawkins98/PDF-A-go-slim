/**
 * Standard font unembedding pass.
 *
 * Removes embedded copies of the 14 standard PDF fonts.
 * Every conforming PDF reader must provide these fonts, so
 * embedding them is pure waste.
 *
 * Only handles Type1 and TrueType (simple fonts).
 * Skips Type0 composites — their Identity-H CIDFont encoding
 * can't be safely replaced with WinAnsiEncoding.
 */
import { PDFName, PDFDict } from 'pdf-lib';

/**
 * The 14 standard PDF fonts and common aliases/variants.
 * Maps various names to the canonical BaseFont name.
 */
const STANDARD_FONT_MAP = new Map([
  // Courier family
  ['Courier', 'Courier'],
  ['Courier-Bold', 'Courier-Bold'],
  ['Courier-Oblique', 'Courier-Oblique'],
  ['Courier-BoldOblique', 'Courier-BoldOblique'],
  ['CourierNew', 'Courier'],
  ['CourierNew,Bold', 'Courier-Bold'],
  ['CourierNew,Italic', 'Courier-Oblique'],
  ['CourierNew,BoldItalic', 'Courier-BoldOblique'],
  ['CourierNewPSMT', 'Courier'],
  ['CourierNewPS-BoldMT', 'Courier-Bold'],
  ['CourierNewPS-ItalicMT', 'Courier-Oblique'],
  ['CourierNewPS-BoldItalicMT', 'Courier-BoldOblique'],

  // Helvetica family
  ['Helvetica', 'Helvetica'],
  ['Helvetica-Bold', 'Helvetica-Bold'],
  ['Helvetica-Oblique', 'Helvetica-Oblique'],
  ['Helvetica-BoldOblique', 'Helvetica-BoldOblique'],
  ['ArialMT', 'Helvetica'],
  ['Arial', 'Helvetica'],
  ['Arial-BoldMT', 'Helvetica-Bold'],
  ['Arial,Bold', 'Helvetica-Bold'],
  ['Arial-ItalicMT', 'Helvetica-Oblique'],
  ['Arial,Italic', 'Helvetica-Oblique'],
  ['Arial-BoldItalicMT', 'Helvetica-BoldOblique'],
  ['Arial,BoldItalic', 'Helvetica-BoldOblique'],

  // Times family
  ['Times-Roman', 'Times-Roman'],
  ['Times-Bold', 'Times-Bold'],
  ['Times-Italic', 'Times-Italic'],
  ['Times-BoldItalic', 'Times-BoldItalic'],
  ['TimesNewRomanPSMT', 'Times-Roman'],
  ['TimesNewRomanPS-BoldMT', 'Times-Bold'],
  ['TimesNewRomanPS-ItalicMT', 'Times-Italic'],
  ['TimesNewRomanPS-BoldItalicMT', 'Times-BoldItalic'],
  ['TimesNewRoman', 'Times-Roman'],
  ['TimesNewRoman,Bold', 'Times-Bold'],
  ['TimesNewRoman,Italic', 'Times-Italic'],
  ['TimesNewRoman,BoldItalic', 'Times-BoldItalic'],

  // Symbol and ZapfDingbats
  ['Symbol', 'Symbol'],
  ['ZapfDingbats', 'ZapfDingbats'],
]);

/**
 * Strip subset prefix from a font name.
 * Subset prefixes are 6 uppercase letters followed by '+'.
 * E.g., "ABCDEF+Helvetica" → "Helvetica"
 */
function stripSubsetPrefix(name) {
  return name.replace(/^[A-Z]{6}\+/, '');
}

/**
 * Check if a font dict has a custom Encoding with Differences.
 * This means the font uses non-standard glyph mappings and
 * should not be unembedded.
 */
function hasCustomDifferences(dict) {
  const encoding = dict.get(PDFName.of('Encoding'));
  if (!encoding) return false;
  if (encoding instanceof PDFDict) {
    return encoding.has(PDFName.of('Differences'));
  }
  return false;
}

/**
 * Remove embedded copies of the 14 standard PDF fonts.
 * @param {PDFDocument} pdfDoc
 * @param {object} [options]
 * @param {boolean} [options.unembedStandardFonts=true] - Enable/disable this pass
 * @returns {{ unembedded: number, skipped: number }}
 */
export function unembedStandardFonts(pdfDoc, options = {}) {
  const { unembedStandardFonts: enabled = true, _pdfTraits } = options;
  const context = pdfDoc.context;
  let unembedded = 0;
  let skipped = 0;

  if (!enabled) {
    return { unembedded: 0, skipped: 0 };
  }

  // PDF/A requires all fonts to be embedded — skip this pass entirely
  if (_pdfTraits?.isPdfA) {
    return { unembedded: 0, skipped: 0, pdfaSkipped: true };
  }

  // Collect refs to delete after processing (FontDescriptor, FontFile streams)
  const refsToDelete = new Set();

  for (const [ref, obj] of context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;

    // Must be a Font dict
    const type = obj.get(PDFName.of('Type'));
    if (!type || !(type instanceof PDFName) || type.decodeText() !== 'Font') {
      continue;
    }

    // Only handle Type1 and TrueType (skip Type0 composites)
    const subtype = obj.get(PDFName.of('Subtype'));
    if (!subtype || !(subtype instanceof PDFName)) continue;
    const subtypeName = subtype.decodeText();
    if (subtypeName !== 'Type1' && subtypeName !== 'TrueType') {
      skipped++;
      continue;
    }

    // Get BaseFont name
    const baseFont = obj.get(PDFName.of('BaseFont'));
    if (!baseFont || !(baseFont instanceof PDFName)) {
      skipped++;
      continue;
    }
    const rawName = baseFont.decodeText();
    const cleanName = stripSubsetPrefix(rawName);

    // Check if it's a standard font
    const canonicalName = STANDARD_FONT_MAP.get(cleanName);
    if (!canonicalName) {
      skipped++;
      continue;
    }

    // Skip fonts with custom Differences encoding
    if (hasCustomDifferences(obj)) {
      skipped++;
      continue;
    }

    // Check if there's actually an embedded font file
    const fontDescriptorRef = obj.get(PDFName.of('FontDescriptor'));
    if (!fontDescriptorRef) {
      skipped++;
      continue;
    }

    // Resolve FontDescriptor
    const fontDescriptor = context.lookup(fontDescriptorRef);
    if (!(fontDescriptor instanceof PDFDict)) {
      skipped++;
      continue;
    }

    // Check for FontFile, FontFile2, or FontFile3
    const fontFileRef =
      fontDescriptor.get(PDFName.of('FontFile')) ||
      fontDescriptor.get(PDFName.of('FontFile2')) ||
      fontDescriptor.get(PDFName.of('FontFile3'));

    if (!fontFileRef) {
      skipped++;
      continue;
    }

    // Save accessibility-critical entries before clearing
    const toUnicodeRef = obj.get(PDFName.of('ToUnicode'));

    // Replace font dict with simple standard font reference
    // Clear existing entries and rebuild
    const keysToRemove = [];
    const entries = obj.entries();
    for (const [key] of entries) {
      keysToRemove.push(key);
    }
    for (const key of keysToRemove) {
      obj.delete(key);
    }

    obj.set(PDFName.of('Type'), PDFName.of('Font'));
    obj.set(PDFName.of('Subtype'), PDFName.of('Type1'));
    obj.set(PDFName.of('BaseFont'), PDFName.of(canonicalName));
    obj.set(PDFName.of('Encoding'), PDFName.of('WinAnsiEncoding'));

    // Restore ToUnicode CMap — needed for text extraction / screen readers
    if (toUnicodeRef) {
      obj.set(PDFName.of('ToUnicode'), toUnicodeRef);
    }

    // Mark FontDescriptor and FontFile for deletion
    refsToDelete.add(fontDescriptorRef);
    refsToDelete.add(fontFileRef);

    unembedded++;
  }

  // Delete collected references
  for (const ref of refsToDelete) {
    try {
      context.delete(ref);
    } catch {
      // Ref may already be gone or shared — ignore
    }
  }

  return { unembedded, skipped };
}

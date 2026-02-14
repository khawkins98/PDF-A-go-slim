import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName, PDFDict } from 'pdf-lib';
import { unembedStandardFonts } from '../../src/engine/optimize/font-unembed.js';
import {
  createPdfWithEmbeddedStandardFont,
  createPdfWithEmbeddedStandardFontAndToUnicode,
  createPdfWithSubsetPrefixedFont,
  createPdfWithType0StandardFont,
  createPdfWithNonStandardFont,
  createPdfAWithEmbeddedFont,
} from '../fixtures/create-test-pdfs.js';

describe('unembedStandardFonts', () => {
  it('removes embedded font file for standard Type1 font', async () => {
    const doc = await createPdfWithEmbeddedStandardFont();
    const sizeBefore = (await doc.save()).length;

    const result = unembedStandardFonts(doc);

    expect(result.unembedded).toBe(1);

    const sizeAfter = (await doc.save()).length;
    expect(sizeAfter).toBeLessThan(sizeBefore);
  });

  it('replaces font dict with simple Type1 reference (no FontDescriptor)', async () => {
    const doc = await createPdfWithEmbeddedStandardFont();
    unembedStandardFonts(doc);

    // Find the font dict and verify it's simplified
    let foundSimpleFont = false;
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFDict)) continue;
      const type = obj.get(PDFName.of('Type'));
      if (!type || !(type instanceof PDFName) || type.decodeText() !== 'Font') continue;

      const subtype = obj.get(PDFName.of('Subtype'));
      if (subtype instanceof PDFName && subtype.decodeText() === 'Type1') {
        const baseFont = obj.get(PDFName.of('BaseFont'));
        if (baseFont instanceof PDFName && baseFont.decodeText() === 'Helvetica') {
          // Should NOT have FontDescriptor anymore
          expect(obj.get(PDFName.of('FontDescriptor'))).toBeUndefined();
          // Should have WinAnsiEncoding
          const encoding = obj.get(PDFName.of('Encoding'));
          expect(encoding).toBeDefined();
          expect(encoding.decodeText()).toBe('WinAnsiEncoding');
          foundSimpleFont = true;
        }
      }
    }
    expect(foundSimpleFont).toBe(true);
  });

  it('skips Type0 composite fonts', async () => {
    const doc = await createPdfWithType0StandardFont();
    const result = unembedStandardFonts(doc);

    // pdf-lib's embedFont creates Type0 composites which should be skipped
    expect(result.unembedded).toBe(0);
  });

  it('skips non-standard font names', async () => {
    const doc = await createPdfWithNonStandardFont();
    const result = unembedStandardFonts(doc);

    expect(result.unembedded).toBe(0);
    expect(result.skipped).toBeGreaterThan(0);
  });

  it('handles subset-prefixed names (ABCDEF+Helvetica)', async () => {
    const doc = await createPdfWithSubsetPrefixedFont();
    const result = unembedStandardFonts(doc);

    expect(result.unembedded).toBe(1);

    // Verify the BaseFont is now the canonical name without prefix
    let found = false;
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFDict)) continue;
      const baseFont = obj.get(PDFName.of('BaseFont'));
      if (baseFont instanceof PDFName && baseFont.decodeText() === 'Helvetica') {
        found = true;
      }
    }
    expect(found).toBe(true);
  });

  it('preserves ToUnicode CMap when unembedding', async () => {
    const doc = await createPdfWithEmbeddedStandardFontAndToUnicode();

    // Verify ToUnicode exists before
    let fontBefore = null;
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFDict)) continue;
      const type = obj.get(PDFName.of('Type'));
      if (type instanceof PDFName && type.decodeText() === 'Font') {
        if (obj.get(PDFName.of('ToUnicode'))) {
          fontBefore = obj;
          break;
        }
      }
    }
    expect(fontBefore).not.toBeNull();

    const result = unembedStandardFonts(doc);
    expect(result.unembedded).toBe(1);

    // ToUnicode must survive unembedding
    let foundToUnicode = false;
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFDict)) continue;
      const type = obj.get(PDFName.of('Type'));
      if (type instanceof PDFName && type.decodeText() === 'Font') {
        const baseFont = obj.get(PDFName.of('BaseFont'));
        if (baseFont instanceof PDFName && baseFont.decodeText() === 'Helvetica') {
          expect(obj.get(PDFName.of('ToUnicode'))).toBeDefined();
          // FontDescriptor should be gone
          expect(obj.get(PDFName.of('FontDescriptor'))).toBeUndefined();
          foundToUnicode = true;
        }
      }
    }
    expect(foundToUnicode).toBe(true);
  });

  it('skips unembedding when PDF/A detected', async () => {
    const doc = await createPdfAWithEmbeddedFont();
    const result = unembedStandardFonts(doc, {
      _pdfTraits: { isPdfA: true, pdfALevel: '1B' },
    });

    expect(result.unembedded).toBe(0);
    expect(result.pdfaSkipped).toBe(true);

    // Font should still have its FontDescriptor (not unembedded)
    let foundDescriptor = false;
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFDict)) continue;
      const type = obj.get(PDFName.of('Type'));
      if (type instanceof PDFName && type.decodeText() === 'Font') {
        if (obj.get(PDFName.of('FontDescriptor'))) {
          foundDescriptor = true;
        }
      }
    }
    expect(foundDescriptor).toBe(true);
  });

  it('disabled when options.unembedStandardFonts === false', async () => {
    const doc = await createPdfWithEmbeddedStandardFont();
    const result = unembedStandardFonts(doc, { unembedStandardFonts: false });

    expect(result.unembedded).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it('produces valid reloadable PDF', async () => {
    const doc = await createPdfWithEmbeddedStandardFont();
    unembedStandardFonts(doc);

    const saved = await doc.save();
    const reloaded = await PDFDocument.load(saved);
    expect(reloaded.getPageCount()).toBe(1);
  });
});

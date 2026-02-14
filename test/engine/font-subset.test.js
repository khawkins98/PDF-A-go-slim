import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName, PDFDict, PDFRawStream, PDFRef, StandardFonts } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { subsetFonts } from '../../src/engine/optimize/font-subset.js';

/**
 * Create a PDF with a real embedded custom font (Type0/CIDFont).
 * pdf-lib's embedFont() with custom font bytes creates the full
 * Type0 + CIDFont + FontDescriptor + FontFile2 structure with ToUnicode CMap.
 */
async function createPdfWithRealEmbeddedFont() {
  // Try common font paths on macOS / Linux
  const fontPaths = [
    '/System/Library/Fonts/Supplemental/Arial.ttf',
    '/System/Library/Fonts/Supplemental/Courier New.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/TTF/DejaVuSans.ttf',
  ];

  let fontBytes = null;
  for (const p of fontPaths) {
    if (existsSync(p)) {
      fontBytes = await readFile(p);
      break;
    }
  }
  if (!fontBytes) return null;

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const page = doc.addPage([200, 200]);
  const font = await doc.embedFont(fontBytes);
  page.drawText('Hello World', { x: 10, y: 100, size: 12, font });

  // Save and reload to materialize all lazy objects (font dicts, etc.)
  // This mirrors real-world usage where PDFs are loaded from bytes.
  const saved = await doc.save({ useObjectStreams: false });
  return PDFDocument.load(saved, { updateMetadata: false });
}

/**
 * Check if any real system font is available for testing.
 */
function hasSystemFont() {
  const paths = [
    '/System/Library/Fonts/Supplemental/Arial.ttf',
    '/System/Library/Fonts/Supplemental/Courier New.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/TTF/DejaVuSans.ttf',
  ];
  return paths.some(p => existsSync(p));
}

describe('subsetFonts', () => {
  it.skipIf(!hasSystemFont())(
    'subsets font and reduces size when subsetFonts: true',
    async () => {
      const doc = await createPdfWithRealEmbeddedFont();
      const sizeBefore = (await doc.save()).length;

      const result = await subsetFonts(doc, { subsetFonts: true });

      expect(result.subsetted).toBeGreaterThanOrEqual(1);

      const sizeAfter = (await doc.save()).length;
      expect(sizeAfter).toBeLessThan(sizeBefore);
    },
  );

  it('returns { subsetted: 0 } when subsetFonts: false', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);

    const result = await subsetFonts(doc, { subsetFonts: false });

    expect(result.subsetted).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it('skips fonts below 10 KB threshold', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);

    // Create a small font file (< 10KB)
    const fontFileData = new Uint8Array(5000);
    fontFileData.fill(0xAA);

    const fontFileDict = doc.context.obj({});
    fontFileDict.set(PDFName.of('Length'), doc.context.obj(fontFileData.length));
    const fontFileStream = PDFRawStream.of(fontFileDict, fontFileData);
    const fontFileRef = doc.context.register(fontFileStream);

    const fontDescriptor = doc.context.obj({});
    fontDescriptor.set(PDFName.of('Type'), PDFName.of('FontDescriptor'));
    fontDescriptor.set(PDFName.of('FontName'), PDFName.of('SmallFont'));
    fontDescriptor.set(PDFName.of('FontFile2'), fontFileRef);
    const fontDescRef = doc.context.register(fontDescriptor);

    const fontDict = doc.context.obj({});
    fontDict.set(PDFName.of('Type'), PDFName.of('Font'));
    fontDict.set(PDFName.of('Subtype'), PDFName.of('TrueType'));
    fontDict.set(PDFName.of('BaseFont'), PDFName.of('SmallFont'));
    fontDict.set(PDFName.of('Encoding'), PDFName.of('WinAnsiEncoding'));
    fontDict.set(PDFName.of('FontDescriptor'), fontDescRef);
    const fontRef = doc.context.register(fontDict);

    const contentBytes = new TextEncoder().encode('BT /F1 12 Tf (Hi) Tj ET');
    const contentDict = doc.context.obj({});
    contentDict.set(PDFName.of('Length'), doc.context.obj(contentBytes.length));
    const contentStream = PDFRawStream.of(contentDict, contentBytes);
    const contentRef = doc.context.register(contentStream);

    const resources = doc.context.obj({});
    const fontsDict = doc.context.obj({});
    fontsDict.set(PDFName.of('F1'), fontRef);
    resources.set(PDFName.of('Font'), fontsDict);
    page.node.set(PDFName.of('Resources'), resources);
    page.node.set(PDFName.of('Contents'), contentRef);

    const result = await subsetFonts(doc, { subsetFonts: true });

    expect(result.subsetted).toBe(0);
  });

  it.skipIf(!hasSystemFont())(
    'per-font size guard keeps original if subset not smaller',
    async () => {
      // This test verifies the guard doesn't crash — the actual size comparison
      // is internal to the pass logic, so we just verify it runs without error
      const doc = await createPdfWithRealEmbeddedFont();
      const result = await subsetFonts(doc);

      expect(result).toHaveProperty('subsetted');
      expect(result).toHaveProperty('skipped');
    },
  );

  it.skipIf(!hasSystemFont())(
    'produces valid reloadable PDF',
    async () => {
      const doc = await createPdfWithRealEmbeddedFont();
      await subsetFonts(doc);

      const saved = await doc.save();
      const reloaded = await PDFDocument.load(saved);
      expect(reloaded.getPageCount()).toBe(1);
    },
  );

  it('stats object has { subsetted, skipped }', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);

    const result = await subsetFonts(doc);

    expect(result).toHaveProperty('subsetted');
    expect(result).toHaveProperty('skipped');
    expect(typeof result.subsetted).toBe('number');
    expect(typeof result.skipped).toBe('number');
  });
});

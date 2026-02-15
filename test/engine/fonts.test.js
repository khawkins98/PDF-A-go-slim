import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName, PDFRawStream, PDFRef } from 'pdf-lib';
import { deflateSync } from 'fflate';
import { deduplicateFonts } from '../../src/engine/optimize/fonts.js';

/**
 * Create a PDF with two font descriptors pointing to identical font file streams.
 */
async function createPdfWithDuplicateFonts() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);

  // Shared font file data (identical for both fonts)
  const fontFileData = new Uint8Array(500);
  for (let i = 0; i < fontFileData.length; i++) fontFileData[i] = i % 256;
  const compressed = deflateSync(fontFileData, { level: 6 });

  // Create two identical font file streams
  function createFontFileStream() {
    const dict = doc.context.obj({});
    dict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
    dict.set(PDFName.of('Length'), doc.context.obj(compressed.length));
    dict.set(PDFName.of('Length1'), doc.context.obj(fontFileData.length));
    return PDFRawStream.of(dict, new Uint8Array(compressed));
  }

  const fontFileRef1 = doc.context.register(createFontFileStream());
  const fontFileRef2 = doc.context.register(createFontFileStream());

  // Create two FontDescriptors pointing to different (but identical) font files
  const fd1 = doc.context.obj({});
  fd1.set(PDFName.of('Type'), PDFName.of('FontDescriptor'));
  fd1.set(PDFName.of('FontName'), PDFName.of('TestFont'));
  fd1.set(PDFName.of('FontFile2'), fontFileRef1);
  const fd1Ref = doc.context.register(fd1);

  const fd2 = doc.context.obj({});
  fd2.set(PDFName.of('Type'), PDFName.of('FontDescriptor'));
  fd2.set(PDFName.of('FontName'), PDFName.of('TestFont'));
  fd2.set(PDFName.of('FontFile2'), fontFileRef2);
  const fd2Ref = doc.context.register(fd2);

  // Create two font dicts
  const font1 = doc.context.obj({});
  font1.set(PDFName.of('Type'), PDFName.of('Font'));
  font1.set(PDFName.of('Subtype'), PDFName.of('TrueType'));
  font1.set(PDFName.of('BaseFont'), PDFName.of('TestFont'));
  font1.set(PDFName.of('FontDescriptor'), fd1Ref);
  const font1Ref = doc.context.register(font1);

  const font2 = doc.context.obj({});
  font2.set(PDFName.of('Type'), PDFName.of('Font'));
  font2.set(PDFName.of('Subtype'), PDFName.of('TrueType'));
  font2.set(PDFName.of('BaseFont'), PDFName.of('TestFont'));
  font2.set(PDFName.of('FontDescriptor'), fd2Ref);
  const font2Ref = doc.context.register(font2);

  // Wire fonts into the page
  const resources = doc.context.obj({});
  const fontsDict = doc.context.obj({});
  fontsDict.set(PDFName.of('F1'), font1Ref);
  fontsDict.set(PDFName.of('F2'), font2Ref);
  resources.set(PDFName.of('Font'), fontsDict);
  page.node.set(PDFName.of('Resources'), resources);

  return doc;
}

describe('deduplicateFonts', () => {
  it('deduplicates identical font file streams', async () => {
    const doc = await createPdfWithDuplicateFonts();

    const countBefore = [...doc.context.enumerateIndirectObjects()].length;
    const result = deduplicateFonts(doc);

    expect(result.deduplicated).toBe(1);

    const countAfter = [...doc.context.enumerateIndirectObjects()].length;
    expect(countAfter).toBeLessThan(countBefore);
  });

  it('returns deduplicated: 0 when no duplicates exist', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([100, 100]);

    // Add a single font descriptor with a unique font file
    const fontData = deflateSync(new Uint8Array([1, 2, 3]), { level: 6 });
    const ffDict = doc.context.obj({});
    ffDict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
    ffDict.set(PDFName.of('Length'), doc.context.obj(fontData.length));
    const ffRef = doc.context.register(PDFRawStream.of(ffDict, fontData));

    const fd = doc.context.obj({});
    fd.set(PDFName.of('Type'), PDFName.of('FontDescriptor'));
    fd.set(PDFName.of('FontName'), PDFName.of('UniqueFont'));
    fd.set(PDFName.of('FontFile2'), ffRef);
    doc.context.register(fd);

    const result = deduplicateFonts(doc);
    expect(result.deduplicated).toBe(0);
  });

  it('produces a valid reloadable PDF after dedup', async () => {
    const doc = await createPdfWithDuplicateFonts();
    deduplicateFonts(doc);

    const bytes = await doc.save();
    const reloaded = await PDFDocument.load(bytes);
    expect(reloaded.getPageCount()).toBe(1);
  });

  it('preserves non-duplicate fonts', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([100, 100]);

    // Add two font descriptors with different font file contents
    const data1 = deflateSync(new Uint8Array([10, 20, 30]), { level: 6 });
    const data2 = deflateSync(new Uint8Array([40, 50, 60]), { level: 6 });

    const ffDict1 = doc.context.obj({});
    ffDict1.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
    ffDict1.set(PDFName.of('Length'), doc.context.obj(data1.length));
    const ffRef1 = doc.context.register(PDFRawStream.of(ffDict1, data1));

    const ffDict2 = doc.context.obj({});
    ffDict2.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
    ffDict2.set(PDFName.of('Length'), doc.context.obj(data2.length));
    const ffRef2 = doc.context.register(PDFRawStream.of(ffDict2, data2));

    const fd1 = doc.context.obj({});
    fd1.set(PDFName.of('Type'), PDFName.of('FontDescriptor'));
    fd1.set(PDFName.of('FontFile2'), ffRef1);
    doc.context.register(fd1);

    const fd2 = doc.context.obj({});
    fd2.set(PDFName.of('Type'), PDFName.of('FontDescriptor'));
    fd2.set(PDFName.of('FontFile2'), ffRef2);
    doc.context.register(fd2);

    const countBefore = [...doc.context.enumerateIndirectObjects()].length;
    const result = deduplicateFonts(doc);
    const countAfter = [...doc.context.enumerateIndirectObjects()].length;

    expect(result.deduplicated).toBe(0);
    expect(countAfter).toBe(countBefore);
  });
});

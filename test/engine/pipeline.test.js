import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName, PDFRawStream, StandardFonts } from 'pdf-lib';
import { deflateSync } from 'fflate';
import { optimize } from '../../src/engine/pipeline.js';

/**
 * Create a bloated PDF with multiple optimization opportunities:
 * - Uncompressed streams
 * - Duplicate objects
 * - XMP metadata
 * - Unreferenced objects
 */
async function createBloatedPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  // Add a page with text
  const page = doc.addPage([400, 400]);
  page.drawText('Bloated PDF for pipeline test', {
    x: 10,
    y: 200,
    size: 14,
    font,
  });

  // Add uncompressed streams (optimization opportunity)
  for (let i = 0; i < 5; i++) {
    const data = new Uint8Array(1000);
    for (let j = 0; j < data.length; j++) data[j] = (i + j) % 256;
    const dict = doc.context.obj({});
    dict.set(PDFName.of('Length'), doc.context.obj(data.length));
    doc.context.register(PDFRawStream.of(dict, data));
  }

  // Add duplicate streams
  const dupData = new Uint8Array(500);
  for (let i = 0; i < dupData.length; i++) dupData[i] = 0xab;
  const compressed = deflateSync(dupData, { level: 1 });
  for (let i = 0; i < 3; i++) {
    const dict = doc.context.obj({});
    dict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
    dict.set(PDFName.of('Length'), doc.context.obj(compressed.length));
    dict.set(PDFName.of('DupMarker'), PDFName.of('Yes'));
    doc.context.register(PDFRawStream.of(dict, new Uint8Array(compressed)));
  }

  // Add XMP metadata
  const xmpData = new TextEncoder().encode(
    '<?xpacket?>' + '<x:xmpmeta>'.repeat(50) + '<?xpacket end="w"?>',
  );
  const xmpDict = doc.context.obj({});
  xmpDict.set(PDFName.of('Type'), PDFName.of('Metadata'));
  xmpDict.set(PDFName.of('Subtype'), PDFName.of('XML'));
  xmpDict.set(PDFName.of('Length'), doc.context.obj(xmpData.length));
  const xmpRef = doc.context.register(PDFRawStream.of(xmpDict, xmpData));
  doc.catalog.set(PDFName.of('Metadata'), xmpRef);

  // Add orphan objects
  for (let i = 0; i < 3; i++) {
    const orphanData = new Uint8Array(500);
    orphanData.fill(0xff);
    const dict = doc.context.obj({});
    dict.set(PDFName.of('Length'), doc.context.obj(orphanData.length));
    doc.context.register(PDFRawStream.of(dict, orphanData));
  }

  return await doc.save();
}

describe('optimize pipeline', () => {
  it('reduces file size on a bloated PDF', async () => {
    const inputBytes = new Uint8Array(await createBloatedPdf());
    const { output, stats } = await optimize(inputBytes);

    expect(output.length).toBeLessThan(inputBytes.length);
    expect(stats.savedBytes).toBeGreaterThan(0);
    expect(stats.savedPercent).toBeGreaterThan(0);
  });

  it('returns original bytes if output would be larger (size guard)', async () => {
    // Create a minimal PDF that can't really be optimized further
    const doc = await PDFDocument.create();
    doc.addPage([100, 100]);
    const minimal = await doc.save({
      useObjectStreams: true,
      addDefaultPage: false,
    });

    const inputBytes = new Uint8Array(minimal);
    const { stats } = await optimize(inputBytes);

    // With the size guard, savedBytes should be 0 or positive
    expect(stats.savedBytes).toBeGreaterThanOrEqual(0);
  });

  it('produces a valid PDF that can be reloaded', async () => {
    const inputBytes = new Uint8Array(await createBloatedPdf());
    const { output } = await optimize(inputBytes);

    const reloaded = await PDFDocument.load(output);
    expect(reloaded.getPageCount()).toBe(1);
  });

  it('preserves page count and dimensions', async () => {
    const inputBytes = new Uint8Array(await createBloatedPdf());
    const { output } = await optimize(inputBytes);

    const original = await PDFDocument.load(inputBytes);
    const optimized = await PDFDocument.load(output);

    expect(optimized.getPageCount()).toBe(original.getPageCount());

    const origPage = original.getPage(0);
    const optPage = optimized.getPage(0);
    expect(optPage.getWidth()).toBe(origPage.getWidth());
    expect(optPage.getHeight()).toBe(origPage.getHeight());
  });

  it('calls progress callback during optimization', async () => {
    const inputBytes = new Uint8Array(await createBloatedPdf());
    const progressCalls = [];

    await optimize(inputBytes, {}, (progress, pass) => {
      progressCalls.push({ progress, pass });
    });

    expect(progressCalls.length).toBeGreaterThan(0);
    // Progress should go from 0 to 1
    expect(progressCalls[0].progress).toBeGreaterThan(0);
    expect(progressCalls[progressCalls.length - 1].progress).toBe(1);
  });
});

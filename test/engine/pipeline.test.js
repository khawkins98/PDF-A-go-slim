import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName, PDFRawStream, PDFString, StandardFonts } from 'pdf-lib';
import { deflateSync } from 'fflate';
import { optimize } from '../../src/engine/pipeline.js';
import {
  createTaggedPdf,
  createPdfAPdf,
  createPdfAWithEmbeddedFont,
} from '../fixtures/create-test-pdfs.js';

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

  it('applies lossy image recompression when lossy option is set', async () => {
    // Create a PDF with a FlateDecode image and bloat
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 400]);

    // Add a FlateDecode RGB image with smooth data (JPEG-friendly)
    const width = 100;
    const height = 100;
    const pixels = new Uint8Array(width * height * 3);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 3;
        const xf = x / width;
        const yf = y / height;
        pixels[idx] = Math.round(127 + 127 * Math.sin(xf * 7.3 + yf * 2.1));
        pixels[idx + 1] = Math.round(127 + 127 * Math.sin(yf * 5.7 + xf * 3.9));
        pixels[idx + 2] = Math.round(127 + 127 * Math.sin((xf + yf) * 4.1));
      }
    }
    const compressed = deflateSync(pixels, { level: 6 });
    const imgDict = doc.context.obj({});
    imgDict.set(PDFName.of('Type'), PDFName.of('XObject'));
    imgDict.set(PDFName.of('Subtype'), PDFName.of('Image'));
    imgDict.set(PDFName.of('Width'), doc.context.obj(width));
    imgDict.set(PDFName.of('Height'), doc.context.obj(height));
    imgDict.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'));
    imgDict.set(PDFName.of('BitsPerComponent'), doc.context.obj(8));
    imgDict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
    imgDict.set(PDFName.of('Length'), doc.context.obj(compressed.length));
    const imgRef = doc.context.register(PDFRawStream.of(imgDict, compressed));

    // Reference image from page
    const xobjectDict = doc.context.obj({});
    xobjectDict.set(PDFName.of('Img0'), imgRef);
    const resources = doc.context.obj({});
    resources.set(PDFName.of('XObject'), xobjectDict);
    page.node.set(PDFName.of('Resources'), resources);

    const inputBytes = new Uint8Array(await doc.save());

    const { output, stats } = await optimize(inputBytes, { lossy: true });

    // With lossy enabled, the image pass should run and produce a valid PDF
    expect(output).toBeDefined();
    const reloaded = await PDFDocument.load(output);
    expect(reloaded.getPageCount()).toBe(1);

    // Verify image recompression pass ran
    const imagePass = stats.passes.find((p) => p.name === 'Recompressing images');
    expect(imagePass).toBeDefined();
    expect(imagePass.converted).toBe(1);
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

  it('reports pdfTraits in stats', async () => {
    const inputBytes = new Uint8Array(await createBloatedPdf());
    const { stats } = await optimize(inputBytes);

    expect(stats.pdfTraits).toBeDefined();
    expect(stats.pdfTraits.isTagged).toBe(false);
    expect(stats.pdfTraits.isPdfA).toBe(false);
  });

  it('preserves structure tree through full pipeline', async () => {
    const doc = await createTaggedPdf();
    const inputBytes = new Uint8Array(await doc.save());

    const { output, stats } = await optimize(inputBytes);

    expect(stats.pdfTraits.isTagged).toBe(true);
    expect(stats.pdfTraits.hasStructTree).toBe(true);

    // Verify structure survives in the output
    const reloaded = await PDFDocument.load(output);
    expect(reloaded.catalog.get(PDFName.of('StructTreeRoot'))).toBeDefined();

    const markInfo = reloaded.catalog.get(PDFName.of('MarkInfo'));
    expect(markInfo).toBeDefined();
  });

  it('preserves XMP for PDF/A through full pipeline', async () => {
    const doc = await createPdfAPdf();
    const inputBytes = new Uint8Array(await doc.save());

    const { output, stats } = await optimize(inputBytes);

    expect(stats.pdfTraits.isPdfA).toBe(true);
    expect(stats.pdfTraits.pdfALevel).toBe('1B');

    // XMP metadata should survive
    const reloaded = await PDFDocument.load(output);
    expect(reloaded.catalog.get(PDFName.of('Metadata'))).toBeDefined();
  });

  it('skips font unembedding for PDF/A', async () => {
    const doc = await createPdfAWithEmbeddedFont();
    const inputBytes = new Uint8Array(await doc.save());

    const { stats } = await optimize(inputBytes);

    const unembedPass = stats.passes.find((p) => p.name === 'Unembedding standard fonts');
    expect(unembedPass).toBeDefined();
    expect(unembedPass.pdfaSkipped).toBe(true);
    expect(unembedPass.unembedded).toBe(0);
  });
});

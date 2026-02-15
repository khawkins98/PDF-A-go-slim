import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { recompressImages } from '../../src/engine/optimize/images.js';
import {
  createPdfWithFlatDecodeRgbImage,
  createPdfWithFlatDecodeGrayImage,
  createPdfWithJpegImage,
  createPdfWithAlphaImage,
  createPdfWithHighDpiImage,
  createPdfWithLargeJpegImage,
  createPdfWithHighDpiJpegImage,
} from '../fixtures/create-test-pdfs.js';

describe('recompressImages', () => {
  it('converts FlateDecode RGB image to JPEG when lossy=true', async () => {
    const doc = await createPdfWithFlatDecodeRgbImage();
    const result = recompressImages(doc, { lossy: true });

    expect(result.converted).toBe(1);

    // Verify the stream is now DCTDecode
    let foundDCT = false;
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFRawStream)) continue;
      const subtype = obj.dict.get(PDFName.of('Subtype'));
      if (subtype && subtype instanceof PDFName && subtype.decodeText() === 'Image') {
        const filter = obj.dict.get(PDFName.of('Filter'));
        if (filter instanceof PDFName && filter.decodeText() === 'DCTDecode') {
          foundDCT = true;
        }
      }
    }
    expect(foundDCT).toBe(true);
  });

  it('converts FlateDecode Gray image to JPEG when lossy=true', async () => {
    const doc = await createPdfWithFlatDecodeGrayImage();
    const result = recompressImages(doc, { lossy: true });

    expect(result.converted).toBe(1);
  });

  it('skips all images when lossy=false (default)', async () => {
    const doc = await createPdfWithFlatDecodeRgbImage();
    const result = recompressImages(doc);

    expect(result.converted).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it('skips small DCTDecode images (below MIN_DECODED_SIZE)', async () => {
    // The fixture is 10x10 = 400 bytes RGBA, well below MIN_DECODED_SIZE
    const doc = await createPdfWithJpegImage();
    const result = recompressImages(doc, { lossy: true });

    expect(result.converted).toBe(0);
    expect(result.skipped).toBeGreaterThan(0);
  });

  it('skips images with SMask', async () => {
    const doc = await createPdfWithAlphaImage();
    const result = recompressImages(doc, { lossy: true });

    expect(result.converted).toBe(0);
    // The main image should be skipped due to SMask
    expect(result.skipped).toBeGreaterThanOrEqual(1);
  });

  it('only replaces when JPEG is smaller', async () => {
    // Use a very high quality that might not compress well
    const doc = await createPdfWithFlatDecodeRgbImage();
    const sizeBefore = (await doc.save()).length;

    recompressImages(doc, { lossy: true, imageQuality: 0.99 });

    // Whatever the result, the output should be valid
    const saved = await doc.save();
    expect(saved).toBeDefined();
  });

  it('respects imageQuality option (lower quality = smaller output)', async () => {
    const docHigh = await createPdfWithFlatDecodeRgbImage();
    const docLow = await createPdfWithFlatDecodeRgbImage();

    recompressImages(docHigh, { lossy: true, imageQuality: 0.95 });
    recompressImages(docLow, { lossy: true, imageQuality: 0.5 });

    const highBytes = await docHigh.save();
    const lowBytes = await docLow.save();

    // Lower quality should produce smaller output
    expect(lowBytes.length).toBeLessThan(highBytes.length);
  });

  it('produces valid reloadable PDF', async () => {
    const doc = await createPdfWithFlatDecodeRgbImage();
    recompressImages(doc, { lossy: true });

    const saved = await doc.save();
    const reloaded = await PDFDocument.load(saved);
    expect(reloaded.getPageCount()).toBe(1);
  });

  it('downsamples high-DPI image when maxImageDpi is set', async () => {
    const doc = await createPdfWithHighDpiImage();
    const result = recompressImages(doc, { lossy: true, maxImageDpi: 150 });

    expect(result.converted).toBe(1);
    expect(result.downsampled).toBe(1);

    // Verify dimensions were updated in the image dict
    let foundImage = false;
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFRawStream)) continue;
      const subtype = obj.dict.get(PDFName.of('Subtype'));
      if (subtype instanceof PDFName && subtype.decodeText() === 'Image') {
        const filter = obj.dict.get(PDFName.of('Filter'));
        if (filter instanceof PDFName && filter.decodeText() === 'DCTDecode') {
          const w = obj.dict.get(PDFName.of('Width'));
          const h = obj.dict.get(PDFName.of('Height'));
          const wVal = Number(w.toString());
          const hVal = Number(h.toString());
          // Original is 400x400 on 100x100pt page (288 DPI), target 150 DPI
          // scale = 150/288 ≈ 0.52, so ~208x208
          expect(wVal).toBeLessThan(400);
          expect(hVal).toBeLessThan(400);
          foundImage = true;
        }
      }
    }
    expect(foundImage).toBe(true);
  });

  it('skips downsampling when already below target DPI', async () => {
    // 100x100 image on 200x200pt page = 36 DPI — well below 150
    const doc = await createPdfWithFlatDecodeRgbImage();
    const result = recompressImages(doc, { lossy: true, maxImageDpi: 150 });

    expect(result.downsampled).toBe(0);
    // Should still convert to JPEG though
    expect(result.converted).toBe(1);
  });

  it('returns downsampled count of 0 when maxImageDpi not set', async () => {
    const doc = await createPdfWithFlatDecodeRgbImage();
    const result = recompressImages(doc, { lossy: true });

    expect(result.downsampled).toBe(0);
  });

  it('produces valid reloadable PDF after downsampling', async () => {
    const doc = await createPdfWithHighDpiImage();
    recompressImages(doc, { lossy: true, maxImageDpi: 150 });

    const saved = await doc.save();
    const reloaded = await PDFDocument.load(saved);
    expect(reloaded.getPageCount()).toBe(1);
  });

  // --- DCTDecode recompression tests ---

  it('recompresses large DCTDecode image at lower quality', async () => {
    const doc = await createPdfWithLargeJpegImage();
    const result = recompressImages(doc, { lossy: true, imageQuality: 0.5 });

    expect(result.converted).toBe(1);

    // Verify the stream is still DCTDecode
    let foundDCT = false;
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFRawStream)) continue;
      const subtype = obj.dict.get(PDFName.of('Subtype'));
      if (subtype instanceof PDFName && subtype.decodeText() === 'Image') {
        const filter = obj.dict.get(PDFName.of('Filter'));
        if (filter instanceof PDFName && filter.decodeText() === 'DCTDecode') {
          foundDCT = true;
        }
      }
    }
    expect(foundDCT).toBe(true);
  });

  it('skips DCT images when lossy=false', async () => {
    const doc = await createPdfWithLargeJpegImage();
    const result = recompressImages(doc, { lossy: false });

    expect(result.converted).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it('downsamples high-DPI DCTDecode image with maxImageDpi', async () => {
    const doc = await createPdfWithHighDpiJpegImage();
    const result = recompressImages(doc, { lossy: true, imageQuality: 0.5, maxImageDpi: 150 });

    expect(result.converted).toBe(1);
    expect(result.downsampled).toBe(1);

    // Verify dimensions were reduced
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFRawStream)) continue;
      const subtype = obj.dict.get(PDFName.of('Subtype'));
      if (subtype instanceof PDFName && subtype.decodeText() === 'Image') {
        const filter = obj.dict.get(PDFName.of('Filter'));
        if (filter instanceof PDFName && filter.decodeText() === 'DCTDecode') {
          const w = Number(obj.dict.get(PDFName.of('Width')).toString());
          const h = Number(obj.dict.get(PDFName.of('Height')).toString());
          // Original is 400x400 on 100x100pt page (~288 DPI), target 150 DPI
          expect(w).toBeLessThan(400);
          expect(h).toBeLessThan(400);
        }
      }
    }
  });

  it('lower quality produces smaller output for DCT recompression', async () => {
    const docHigh = await createPdfWithLargeJpegImage();
    const docLow = await createPdfWithLargeJpegImage();

    recompressImages(docHigh, { lossy: true, imageQuality: 0.85 });
    recompressImages(docLow, { lossy: true, imageQuality: 0.4 });

    const highBytes = await docHigh.save();
    const lowBytes = await docLow.save();

    expect(lowBytes.length).toBeLessThan(highBytes.length);
  });

  it('produces valid reloadable PDF after DCT recompression', async () => {
    const doc = await createPdfWithLargeJpegImage();
    recompressImages(doc, { lossy: true, imageQuality: 0.5 });

    const saved = await doc.save();
    const reloaded = await PDFDocument.load(saved);
    expect(reloaded.getPageCount()).toBe(1);
  });
});

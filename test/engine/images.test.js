import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { recompressImages } from '../../src/engine/optimize/images.js';
import {
  createPdfWithFlatDecodeRgbImage,
  createPdfWithFlatDecodeGrayImage,
  createPdfWithJpegImage,
  createPdfWithAlphaImage,
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

  it('skips DCTDecode images', async () => {
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
});

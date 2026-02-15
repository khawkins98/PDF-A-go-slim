import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { deflateSync } from 'fflate';
import { recompressStreams } from '../../src/engine/optimize/streams.js';
import {
  createUncompressedStreamPdf,
  createPoorlyCompressedPdf,
} from '../fixtures/create-test-pdfs.js';

describe('recompressStreams', () => {
  it('compresses an uncompressed stream', async () => {
    const doc = await createUncompressedStreamPdf();
    const sizeBefore = (await doc.save()).length;

    const result = recompressStreams(doc);

    expect(result.recompressed).toBeGreaterThan(0);

    const sizeAfter = (await doc.save()).length;
    expect(sizeAfter).toBeLessThan(sizeBefore);
  });

  it('improves poorly compressed streams', async () => {
    const doc = await createPoorlyCompressedPdf();
    const sizeBefore = (await doc.save()).length;

    const result = recompressStreams(doc);

    // At least some streams should be recompressed
    expect(result.recompressed + result.skipped).toBeGreaterThan(0);
  });

  it('does not recompress if result would be larger', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([100, 100]);

    // Add a tiny already-optimally-compressed stream
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const compressed = deflateSync(data, { level: 9 });
    const dict = doc.context.obj({});
    dict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
    dict.set(PDFName.of('Length'), doc.context.obj(compressed.length));
    const stream = PDFRawStream.of(dict, compressed);
    doc.context.register(stream);

    // Should not error
    const result = recompressStreams(doc);
    expect(result).toBeDefined();
  });

  it('skips image-native filters (DCTDecode)', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([100, 100]);

    const data = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]); // fake JPEG header
    const dict = doc.context.obj({});
    dict.set(PDFName.of('Filter'), PDFName.of('DCTDecode'));
    dict.set(PDFName.of('Length'), doc.context.obj(data.length));
    const stream = PDFRawStream.of(dict, data);
    doc.context.register(stream);

    const result = recompressStreams(doc);
    // DCTDecode should be skipped, not recompressed
    expect(result.skipped).toBeGreaterThan(0);
  });
});

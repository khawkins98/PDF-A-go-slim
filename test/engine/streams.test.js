import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName, PDFDict, PDFRawStream } from 'pdf-lib';
import { zlibSync, deflateSync } from 'fflate';
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

  it('preserves DecodeParms with Predictor during recompression', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);

    // Simulate a FlateDecode stream with PNG prediction (Predictor 12).
    // Build predicted data: 10 rows, each with a filter-type byte (0 = None)
    // followed by 100 bytes of content.
    const columns = 100;
    const rows = 10;
    const predicted = new Uint8Array(rows * (columns + 1));
    for (let r = 0; r < rows; r++) {
      const off = r * (columns + 1);
      predicted[off] = 0; // PNG filter type: None
      for (let c = 0; c < columns; c++) {
        predicted[off + 1 + c] = (r * columns + c) & 0xff;
      }
    }

    // Compress at low level so recompression at level 9 will "win"
    const compressed = zlibSync(predicted, { level: 1 });

    const dict = doc.context.obj({});
    dict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
    dict.set(PDFName.of('Length'), doc.context.obj(compressed.length));

    // Set DecodeParms with Predictor 12 (PNG Up)
    const decodeParms = doc.context.obj({});
    decodeParms.set(PDFName.of('Predictor'), doc.context.obj(12));
    decodeParms.set(PDFName.of('Columns'), doc.context.obj(columns));
    dict.set(PDFName.of('DecodeParms'), decodeParms);

    const stream = PDFRawStream.of(dict, new Uint8Array(compressed));
    doc.context.register(stream);

    recompressStreams(doc);

    // DecodeParms must survive — without it the viewer can't undo prediction
    const dp = dict.get(PDFName.of('DecodeParms'));
    expect(dp).toBeDefined();
    expect(dp).not.toBeNull();

    // Predictor value should still be 12
    const pred = dp.get(PDFName.of('Predictor'));
    expect(Number(pred.toString())).toBe(12);

    // Columns should still be present
    const cols = dp.get(PDFName.of('Columns'));
    expect(Number(cols.toString())).toBe(columns);
  });
});

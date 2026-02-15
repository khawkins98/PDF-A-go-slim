import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { deflateSync } from 'fflate';
import { deduplicateObjects } from '../../src/engine/optimize/dedup.js';
import { createDuplicateObjectsPdf } from '../fixtures/create-test-pdfs.js';

describe('deduplicateObjects', () => {
  it('removes duplicate stream objects', async () => {
    const doc = await createDuplicateObjectsPdf();

    const countBefore = [...doc.context.enumerateIndirectObjects()].length;
    const result = deduplicateObjects(doc);

    expect(result.deduplicated).toBeGreaterThan(0);

    const countAfter = [...doc.context.enumerateIndirectObjects()].length;
    expect(countAfter).toBeLessThan(countBefore);
  });

  it('does not deduplicate unique objects', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([100, 100]);

    // Add two different streams
    const data1 = deflateSync(new Uint8Array([1, 2, 3]), { level: 6 });
    const data2 = deflateSync(new Uint8Array([4, 5, 6]), { level: 6 });

    const dict1 = doc.context.obj({});
    dict1.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
    dict1.set(PDFName.of('Length'), doc.context.obj(data1.length));
    doc.context.register(PDFRawStream.of(dict1, data1));

    const dict2 = doc.context.obj({});
    dict2.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
    dict2.set(PDFName.of('Length'), doc.context.obj(data2.length));
    doc.context.register(PDFRawStream.of(dict2, data2));

    const result = deduplicateObjects(doc);
    expect(result.deduplicated).toBe(0);
  });

  it('produces a valid PDF after dedup', async () => {
    const doc = await createDuplicateObjectsPdf();
    deduplicateObjects(doc);

    const bytes = await doc.save();
    // Should be loadable
    const reloaded = await PDFDocument.load(bytes);
    expect(reloaded.getPageCount()).toBe(1);
  });
});

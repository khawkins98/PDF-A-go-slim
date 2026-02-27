import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName, PDFRef, PDFRawStream } from 'pdf-lib';
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

  it('skips page content streams', async () => {
    // Create a PDF with two pages whose content streams are byte-identical
    const doc = await PDFDocument.create();
    const contentBytes = deflateSync(
      new TextEncoder().encode('BT /F1 12 Tf (Hello) Tj ET'),
      { level: 6 },
    );

    // Build two pages with identical content streams
    for (let i = 0; i < 2; i++) {
      const page = doc.addPage([200, 200]);
      const dict = doc.context.obj({});
      dict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
      dict.set(PDFName.of('Length'), doc.context.obj(contentBytes.length));
      const stream = PDFRawStream.of(dict, new Uint8Array(contentBytes));
      const ref = doc.context.register(stream);
      page.node.set(PDFName.of('Contents'), ref);
    }

    // Collect content stream refs before dedup
    const refsBefore = new Set();
    for (const page of doc.getPages()) {
      const c = page.node.get(PDFName.of('Contents'));
      if (c instanceof PDFRef) refsBefore.add(c.tag);
    }

    const result = deduplicateObjects(doc);

    // Content streams should be skipped, not merged
    expect(result.contentStreamsSkipped).toBe(2);

    // Both pages should still point to distinct content stream refs
    const refsAfter = new Set();
    for (const page of doc.getPages()) {
      const c = page.node.get(PDFName.of('Contents'));
      if (c instanceof PDFRef) refsAfter.add(c.tag);
    }
    expect(refsAfter.size).toBe(2);

    // The original refs should be unchanged
    for (const tag of refsBefore) {
      expect(refsAfter.has(tag)).toBe(true);
    }
  });
});

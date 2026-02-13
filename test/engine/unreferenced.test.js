import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { removeUnreferencedObjects } from '../../src/engine/optimize/unreferenced.js';
import { createUnreferencedObjectPdf } from '../fixtures/create-test-pdfs.js';

describe('removeUnreferencedObjects', () => {
  it('removes orphaned objects', async () => {
    const doc = await createUnreferencedObjectPdf();

    const countBefore = [...doc.context.enumerateIndirectObjects()].length;
    const result = removeUnreferencedObjects(doc);

    expect(result.removed).toBeGreaterThan(0);

    const countAfter = [...doc.context.enumerateIndirectObjects()].length;
    expect(countAfter).toBeLessThan(countBefore);
  });

  it('does not remove referenced objects', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([100, 100]);

    const countBefore = [...doc.context.enumerateIndirectObjects()].length;
    const result = removeUnreferencedObjects(doc);

    // A freshly created doc should have no orphans
    expect(result.removed).toBe(0);
    const countAfter = [...doc.context.enumerateIndirectObjects()].length;
    expect(countAfter).toBe(countBefore);
  });

  it('produces a valid PDF after removal', async () => {
    const doc = await createUnreferencedObjectPdf();
    removeUnreferencedObjects(doc);

    const bytes = await doc.save();
    const reloaded = await PDFDocument.load(bytes);
    expect(reloaded.getPageCount()).toBe(1);
  });
});

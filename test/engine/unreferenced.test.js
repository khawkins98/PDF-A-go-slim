import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName } from 'pdf-lib';
import { removeUnreferencedObjects } from '../../src/engine/optimize/unreferenced.js';
import { createUnreferencedObjectPdf, createTaggedPdfWithOrphans } from '../fixtures/create-test-pdfs.js';

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

  it('does not remove StructTreeRoot or descendants', async () => {
    const doc = await createTaggedPdfWithOrphans();

    // Verify StructTreeRoot exists before
    expect(doc.catalog.get(PDFName.of('StructTreeRoot'))).toBeDefined();

    const countBefore = [...doc.context.enumerateIndirectObjects()].length;
    const result = removeUnreferencedObjects(doc);

    // Should remove orphans but not structure tree
    expect(result.removed).toBeGreaterThan(0);

    // StructTreeRoot must still be present and resolvable
    const structTreeRef = doc.catalog.get(PDFName.of('StructTreeRoot'));
    expect(structTreeRef).toBeDefined();
    const structTree = doc.context.lookup(structTreeRef);
    expect(structTree).toBeDefined();

    // The children (StructElem) should also survive
    const kids = structTree.get(PDFName.of('K'));
    expect(kids).toBeDefined();

    // PDF should still be valid
    const bytes = await doc.save();
    const reloaded = await PDFDocument.load(bytes);
    expect(reloaded.getPageCount()).toBe(1);
  });

  it('produces a valid PDF after removal', async () => {
    const doc = await createUnreferencedObjectPdf();
    removeUnreferencedObjects(doc);

    const bytes = await doc.save();
    const reloaded = await PDFDocument.load(bytes);
    expect(reloaded.getPageCount()).toBe(1);
  });
});

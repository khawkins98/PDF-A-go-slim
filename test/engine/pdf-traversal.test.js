import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName, PDFRawStream, PDFRef } from 'pdf-lib';
import { deflateSync } from 'fflate';
import { findReachableRefs } from '../../src/engine/utils/pdf-traversal.js';

describe('findReachableRefs', () => {
  it('finds all reachable refs from a simple PDF', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([100, 100]);

    const refs = findReachableRefs(doc.context);

    // Should find at least the catalog (Root) and page tree refs
    expect(refs.size).toBeGreaterThan(0);

    // The catalog ref should be reachable
    const rootRef = doc.context.trailerInfo.Root;
    expect(refs.has(rootRef.tag)).toBe(true);
  });

  it('handles circular references gracefully', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([100, 100]);

    // Create two dicts that reference each other
    const dict1 = doc.context.obj({});
    const dict2 = doc.context.obj({});
    const ref1 = doc.context.register(dict1);
    const ref2 = doc.context.register(dict2);
    dict1.set(PDFName.of('Sibling'), ref2);
    dict2.set(PDFName.of('Sibling'), ref1);

    // Wire one into the catalog so they're reachable
    doc.catalog.set(PDFName.of('TestCircular'), ref1);

    // Should not infinite loop
    const refs = findReachableRefs(doc.context);
    expect(refs.has(ref1.tag)).toBe(true);
    expect(refs.has(ref2.tag)).toBe(true);
  });

  it('includes refs nested in arrays and dicts', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([100, 100]);

    // Create a nested structure: catalog → dict → array → ref → stream
    const streamData = deflateSync(new Uint8Array([1, 2, 3]));
    const streamDict = doc.context.obj({});
    streamDict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
    streamDict.set(PDFName.of('Length'), doc.context.obj(streamData.length));
    const stream = PDFRawStream.of(streamDict, streamData);
    const streamRef = doc.context.register(stream);

    const arr = doc.context.obj([streamRef]);
    const arrRef = doc.context.register(arr);

    const wrapper = doc.context.obj({});
    wrapper.set(PDFName.of('Items'), arrRef);
    const wrapperRef = doc.context.register(wrapper);

    doc.catalog.set(PDFName.of('TestNested'), wrapperRef);

    const refs = findReachableRefs(doc.context);
    expect(refs.has(wrapperRef.tag)).toBe(true);
    expect(refs.has(arrRef.tag)).toBe(true);
    expect(refs.has(streamRef.tag)).toBe(true);
  });

  it('does not include unreferenced objects', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([100, 100]);

    // Register an orphan object not linked from the catalog
    const orphan = doc.context.obj({ Orphan: 'yes' });
    const orphanRef = doc.context.register(orphan);

    const refs = findReachableRefs(doc.context);
    expect(refs.has(orphanRef.tag)).toBe(false);
  });
});

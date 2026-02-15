import { describe, it, expect } from 'vitest';
import {
  PDFDocument,
  PDFName,
  PDFDict,
  PDFRawStream,
  StandardFonts,
} from 'pdf-lib';
import { deflateSync } from 'fflate';
import { extractUsedCharCodes } from '../../src/engine/utils/content-stream-parser.js';
import {
  createPdfWithContentStreamText,
} from '../fixtures/create-test-pdfs.js';

/**
 * Helper: create a PDF with a given content stream string and simple font resources.
 */
async function createPdfWithContent(contentText, { fontNames = ['F1'], extraResources } = {}) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);

  // Create font dicts for each font name
  const fontsDict = doc.context.obj({});
  for (const name of fontNames) {
    const fontDict = doc.context.obj({});
    fontDict.set(PDFName.of('Type'), PDFName.of('Font'));
    fontDict.set(PDFName.of('Subtype'), PDFName.of('Type1'));
    fontDict.set(PDFName.of('BaseFont'), PDFName.of('TestFont'));
    const fontRef = doc.context.register(fontDict);
    fontsDict.set(PDFName.of(name), fontRef);
  }

  const resources = doc.context.obj({});
  resources.set(PDFName.of('Font'), fontsDict);

  if (extraResources) {
    extraResources(doc, resources);
  }

  page.node.set(PDFName.of('Resources'), resources);

  // Create content stream
  const contentBytes = new TextEncoder().encode(contentText);
  const contentDict = doc.context.obj({});
  contentDict.set(PDFName.of('Length'), doc.context.obj(contentBytes.length));
  const contentStream = PDFRawStream.of(contentDict, contentBytes);
  const contentRef = doc.context.register(contentStream);
  page.node.set(PDFName.of('Contents'), contentRef);

  return doc;
}

describe('extractUsedCharCodes', () => {
  it('extracts char codes from Tj with literal string', async () => {
    const doc = await createPdfWithContent('BT /F1 12 Tf (Hello) Tj ET');
    const result = extractUsedCharCodes(doc);

    expect(result.size).toBe(1);
    const entry = [...result.values()][0];
    expect(entry.charCodes.length).toBe(1);
    // "Hello" = [72, 101, 108, 108, 111]
    expect([...entry.charCodes[0]]).toEqual([72, 101, 108, 108, 111]);
  });

  it('extracts char codes from TJ with mixed array', async () => {
    const doc = await createPdfWithContent('BT /F1 12 Tf [(AB) -50 (CD)] TJ ET');
    const result = extractUsedCharCodes(doc);

    expect(result.size).toBe(1);
    const entry = [...result.values()][0];
    // Should have two string operands: "AB" and "CD"
    expect(entry.charCodes.length).toBe(2);
    expect([...entry.charCodes[0]]).toEqual([65, 66]);
    expect([...entry.charCodes[1]]).toEqual([67, 68]);
  });

  it('extracts char codes from hex strings', async () => {
    const doc = await createPdfWithContent('BT /F1 12 Tf <48656C6C6F> Tj ET');
    const result = extractUsedCharCodes(doc);

    expect(result.size).toBe(1);
    const entry = [...result.values()][0];
    expect(entry.charCodes.length).toBe(1);
    // "Hello" in hex
    expect([...entry.charCodes[0]]).toEqual([72, 101, 108, 108, 111]);
  });

  it('handles multiple fonts (Tf switching)', async () => {
    const doc = await createPdfWithContent(
      'BT /F1 12 Tf (AB) Tj /F2 14 Tf (CD) Tj ET',
      { fontNames: ['F1', 'F2'] },
    );
    const result = extractUsedCharCodes(doc);

    expect(result.size).toBe(2);
    const entries = [...result.values()];
    // One font has AB, the other has CD
    const allCodes = entries.map(e => [...e.charCodes[0]]);
    expect(allCodes).toContainEqual([65, 66]);
    expect(allCodes).toContainEqual([67, 68]);
  });

  it("handles ' operator (move to next line and show string)", async () => {
    const doc = await createPdfWithContent("BT /F1 12 Tf (Hi) ' ET");
    const result = extractUsedCharCodes(doc);

    expect(result.size).toBe(1);
    const entry = [...result.values()][0];
    expect([...entry.charCodes[0]]).toEqual([72, 105]);
  });

  it('handles " operator (set spacing and show string)', async () => {
    const doc = await createPdfWithContent('BT /F1 12 Tf 0 0 (Hi) " ET');
    const result = extractUsedCharCodes(doc);

    expect(result.size).toBe(1);
    const entry = [...result.values()][0];
    expect([...entry.charCodes[0]]).toEqual([72, 105]);
  });

  it('follows Do into Form XObjects', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);

    // Create font
    const fontDict = doc.context.obj({});
    fontDict.set(PDFName.of('Type'), PDFName.of('Font'));
    fontDict.set(PDFName.of('Subtype'), PDFName.of('Type1'));
    fontDict.set(PDFName.of('BaseFont'), PDFName.of('TestFont'));
    const fontRef = doc.context.register(fontDict);

    // Create Form XObject with its own content and resources
    const formContent = new TextEncoder().encode('BT /F1 12 Tf (XObj) Tj ET');
    const formResourcesDict = doc.context.obj({});
    const formFontsDict = doc.context.obj({});
    formFontsDict.set(PDFName.of('F1'), fontRef);
    formResourcesDict.set(PDFName.of('Font'), formFontsDict);

    const formDict = doc.context.obj({});
    formDict.set(PDFName.of('Type'), PDFName.of('XObject'));
    formDict.set(PDFName.of('Subtype'), PDFName.of('Form'));
    formDict.set(PDFName.of('BBox'), doc.context.obj([0, 0, 200, 200]));
    formDict.set(PDFName.of('Resources'), formResourcesDict);
    formDict.set(PDFName.of('Length'), doc.context.obj(formContent.length));
    const formStream = PDFRawStream.of(formDict, formContent);
    const formRef = doc.context.register(formStream);

    // Page content: just calls the Form XObject
    const pageContent = new TextEncoder().encode('/MyForm Do');
    const pageContentDict = doc.context.obj({});
    pageContentDict.set(PDFName.of('Length'), doc.context.obj(pageContent.length));
    const pageContentStream = PDFRawStream.of(pageContentDict, pageContent);
    const pageContentRef = doc.context.register(pageContentStream);

    // Page resources
    const xobjectDict = doc.context.obj({});
    xobjectDict.set(PDFName.of('MyForm'), formRef);
    const resources = doc.context.obj({});
    resources.set(PDFName.of('XObject'), xobjectDict);
    page.node.set(PDFName.of('Resources'), resources);
    page.node.set(PDFName.of('Contents'), pageContentRef);

    const result = extractUsedCharCodes(doc);
    expect(result.size).toBe(1);
    const entry = [...result.values()][0];
    // "XObj" = [88, 79, 98, 106]
    expect([...entry.charCodes[0]]).toEqual([88, 79, 98, 106]);
  });

  it('handles content stream as array of stream refs', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);

    // Create font
    const fontDict = doc.context.obj({});
    fontDict.set(PDFName.of('Type'), PDFName.of('Font'));
    fontDict.set(PDFName.of('Subtype'), PDFName.of('Type1'));
    fontDict.set(PDFName.of('BaseFont'), PDFName.of('TestFont'));
    const fontRef = doc.context.register(fontDict);

    // Two content stream parts
    const part1 = new TextEncoder().encode('BT /F1 12 Tf');
    const part2 = new TextEncoder().encode('(Hi) Tj ET');

    const dict1 = doc.context.obj({});
    dict1.set(PDFName.of('Length'), doc.context.obj(part1.length));
    const stream1 = PDFRawStream.of(dict1, part1);
    const ref1 = doc.context.register(stream1);

    const dict2 = doc.context.obj({});
    dict2.set(PDFName.of('Length'), doc.context.obj(part2.length));
    const stream2 = PDFRawStream.of(dict2, part2);
    const ref2 = doc.context.register(stream2);

    // Set Contents as array
    page.node.set(PDFName.of('Contents'), doc.context.obj([ref1, ref2]));

    // Resources
    const fontsDict = doc.context.obj({});
    fontsDict.set(PDFName.of('F1'), fontRef);
    const resources = doc.context.obj({});
    resources.set(PDFName.of('Font'), fontsDict);
    page.node.set(PDFName.of('Resources'), resources);

    const result = extractUsedCharCodes(doc);
    expect(result.size).toBe(1);
    const entry = [...result.values()][0];
    expect([...entry.charCodes[0]]).toEqual([72, 105]);
  });

  it('graceful on empty content streams', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);

    const contentBytes = new Uint8Array(0);
    const contentDict = doc.context.obj({});
    contentDict.set(PDFName.of('Length'), doc.context.obj(0));
    const contentStream = PDFRawStream.of(contentDict, contentBytes);
    const contentRef = doc.context.register(contentStream);
    page.node.set(PDFName.of('Contents'), contentRef);

    const result = extractUsedCharCodes(doc);
    expect(result.size).toBe(0);
  });
});

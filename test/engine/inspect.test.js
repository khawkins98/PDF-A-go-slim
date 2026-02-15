import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName, PDFDict, PDFRawStream } from 'pdf-lib';
import { deflateSync } from 'fflate';
import { inspectDocument } from '../../src/engine/inspect.js';
import { optimize } from '../../src/engine/pipeline.js';
import {
  createPdfWithEmbeddedStandardFont,
  createPdfWithSubsetPrefixedFont,
  createPdfWithFlatDecodeRgbImage,
  createMetadataBloatPdf,
  createPdfWithContentStreamText,
} from '../fixtures/create-test-pdfs.js';

const EXPECTED_LABELS = [
  'Fonts',
  'Images',
  'Page Content',
  'Metadata',
  'Document Structure',
  'Other Data',
];

describe('inspectDocument', () => {
  it('returns all 6 categories in fixed order', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    const result = inspectDocument(doc);

    expect(result.categories).toHaveLength(6);
    expect(result.categories.map((c) => c.label)).toEqual(EXPECTED_LABELS);
  });

  it('classifies fonts with displayName', async () => {
    const doc = await createPdfWithEmbeddedStandardFont();
    const result = inspectDocument(doc);
    const fonts = result.categories.find((c) => c.label === 'Fonts');

    expect(fonts.count).toBeGreaterThan(0);
    // Should have a Font dict with displayName
    const fontDict = fonts.items.find((i) => i.name === 'Helvetica' && i.detail === 'Type1');
    expect(fontDict).toBeDefined();
    expect(fontDict.displayName).toBe('Helvetica (Type 1)');
    // Should also have a font file stream
    const fontFile = fonts.items.find((i) => i.detail === 'font file');
    expect(fontFile).toBeDefined();
    expect(fontFile.size).toBeGreaterThan(0);
    expect(fontFile.displayName).toBe('Font program data');
  });

  it('strips subset prefix from font displayName', async () => {
    const doc = await createPdfWithSubsetPrefixedFont();
    const result = inspectDocument(doc);
    const fonts = result.categories.find((c) => c.label === 'Fonts');

    const fontDict = fonts.items.find((i) => i.name === 'ABCDEF+Helvetica' && i.detail === 'TrueType');
    expect(fontDict).toBeDefined();
    // displayName should not have the ABCDEF+ prefix
    expect(fontDict.displayName).toBe('Helvetica (TrueType)');

    const descriptor = fonts.items.find((i) => i.detail === 'FontDescriptor');
    expect(descriptor).toBeDefined();
    expect(descriptor.displayName).toBe('Helvetica descriptor');
  });

  it('classifies images with dimensions and abbreviated colorspace', async () => {
    const doc = await createPdfWithFlatDecodeRgbImage();
    const result = inspectDocument(doc);
    const images = result.categories.find((c) => c.label === 'Images');

    expect(images.count).toBeGreaterThan(0);
    expect(images.items.length).toBeGreaterThan(0);
    const img = images.items[0];
    expect(img.size).toBeGreaterThan(0);
    expect(img.detail).toContain('100x100');
    expect(img.detail).toContain('DeviceRGB');
    // displayName uses abbreviated format
    expect(img.displayName).toContain('100 \u00d7 100');
    expect(img.displayName).toContain('RGB');
  });

  it('classifies metadata with displayName', async () => {
    const doc = await createMetadataBloatPdf();
    const result = inspectDocument(doc);
    const metadata = result.categories.find((c) => c.label === 'Metadata');

    expect(metadata.count).toBeGreaterThan(0);
    expect(metadata.items.length).toBeGreaterThan(0);
    const xmp = metadata.items.find((i) => i.displayName === 'XMP Metadata');
    expect(xmp).toBeDefined();
  });

  it('classifies content streams with page numbers', async () => {
    const doc = await createPdfWithContentStreamText();
    const result = inspectDocument(doc);
    const content = result.categories.find((c) => c.label === 'Page Content');

    expect(content.count).toBeGreaterThan(0);
    const pageItem = content.items.find((i) => i.name === 'Page 1');
    expect(pageItem).toBeDefined();
    expect(pageItem.displayName).toBe('Page 1');
  });

  it('classifies page tree into Document Structure', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    const result = inspectDocument(doc);
    const structure = result.categories.find((c) => c.label === 'Document Structure');

    expect(structure.count).toBeGreaterThan(0);
    const catalog = structure.items.find((i) => i.detail === 'Catalog');
    expect(catalog).toBeDefined();
    expect(catalog.displayName).toBe('Catalog');
  });

  it('totalSize equals sum of category sizes', async () => {
    const doc = await createPdfWithFlatDecodeRgbImage();
    const result = inspectDocument(doc);

    const sumOfCategories = result.categories.reduce((s, c) => s + c.totalSize, 0);
    expect(result.totalSize).toBe(sumOfCategories);
  });

  it('objectCount equals sum of category counts', async () => {
    const doc = await createPdfWithEmbeddedStandardFont();
    const result = inspectDocument(doc);

    const sumOfCounts = result.categories.reduce((s, c) => s + c.count, 0);
    expect(result.objectCount).toBe(sumOfCounts);
  });

  it('result is JSON-serializable', async () => {
    const doc = await createPdfWithEmbeddedStandardFont();
    const result = inspectDocument(doc);

    const roundTripped = JSON.parse(JSON.stringify(result));
    expect(roundTripped).toEqual(result);
  });

  it('pipeline attaches inspect.before and inspect.after', async () => {
    const doc = await createMetadataBloatPdf();
    const bytes = await doc.save();
    const { stats } = await optimize(new Uint8Array(bytes));

    expect(stats.inspect).toBeDefined();
    expect(stats.inspect.before).toBeDefined();
    expect(stats.inspect.after).toBeDefined();
    expect(stats.inspect.before.categories).toHaveLength(6);
    expect(stats.inspect.after.categories).toHaveLength(6);
  });

  describe('Other Data sub-categories', () => {
    it('classifies dicts with Widths as Font Support / Glyph Widths', async () => {
      const doc = await PDFDocument.create();
      doc.addPage();
      const widthsDict = doc.context.obj({});
      widthsDict.set(PDFName.of('Widths'), doc.context.obj([250, 300]));
      doc.context.register(widthsDict);

      const result = inspectDocument(doc);
      const other = result.categories.find((c) => c.label === 'Other Data');
      const widthItem = other.items.find((i) => i.displayName === 'Glyph Widths');
      expect(widthItem).toBeDefined();
      expect(widthItem.subCategory).toBe('Font Support');
    });

    it('classifies dicts with Differences as Font Support / Font Encoding', async () => {
      const doc = await PDFDocument.create();
      doc.addPage();
      const encDict = doc.context.obj({});
      encDict.set(PDFName.of('Differences'), doc.context.obj([24]));
      doc.context.register(encDict);

      const result = inspectDocument(doc);
      const other = result.categories.find((c) => c.label === 'Other Data');
      const encItem = other.items.find((i) => i.displayName === 'Font Encoding');
      expect(encItem).toBeDefined();
      expect(encItem.subCategory).toBe('Font Support');
    });

    it('classifies dicts with Registry as Font Support / CID Info', async () => {
      const doc = await PDFDocument.create();
      doc.addPage();
      const cidDict = doc.context.obj({});
      cidDict.set(PDFName.of('Registry'), doc.context.obj('Adobe'));
      doc.context.register(cidDict);

      const result = inspectDocument(doc);
      const other = result.categories.find((c) => c.label === 'Other Data');
      const cidItem = other.items.find((i) => i.displayName === 'CID Info');
      expect(cidItem).toBeDefined();
      expect(cidItem.subCategory).toBe('Font Support');
    });

    it('classifies plain streams as Miscellaneous / Data stream', async () => {
      const doc = await PDFDocument.create();
      doc.addPage();
      const data = new Uint8Array(100);
      data.fill(42);
      const compressed = deflateSync(data, { level: 6 });
      const dict = doc.context.obj({});
      dict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
      dict.set(PDFName.of('Length'), doc.context.obj(compressed.length));
      const stream = PDFRawStream.of(dict, compressed);
      doc.context.register(stream);

      const result = inspectDocument(doc);
      const other = result.categories.find((c) => c.label === 'Other Data');
      const miscItem = other.items.find((i) => i.displayName === 'Data stream');
      expect(miscItem).toBeDefined();
      expect(miscItem.subCategory).toBe('Miscellaneous');
    });

    it('classifies plain dicts as Miscellaneous / Structure data', async () => {
      const doc = await PDFDocument.create();
      doc.addPage();
      const plainDict = doc.context.obj({});
      plainDict.set(PDFName.of('SomeKey'), doc.context.obj('SomeValue'));
      doc.context.register(plainDict);

      const result = inspectDocument(doc);
      const other = result.categories.find((c) => c.label === 'Other Data');
      const structItem = other.items.find((i) => i.displayName === 'Structure data');
      expect(structItem).toBeDefined();
      expect(structItem.subCategory).toBe('Miscellaneous');
    });

    it('classifies Form XObject streams as Graphics', async () => {
      const doc = await PDFDocument.create();
      doc.addPage();
      const formData = new Uint8Array(50);
      formData.fill(0);
      const dict = doc.context.obj({});
      dict.set(PDFName.of('Subtype'), PDFName.of('Form'));
      dict.set(PDFName.of('Length'), doc.context.obj(formData.length));
      const stream = PDFRawStream.of(dict, formData);
      doc.context.register(stream);

      const result = inspectDocument(doc);
      const other = result.categories.find((c) => c.label === 'Other Data');
      const formItem = other.items.find((i) => i.displayName === 'Form XObject');
      expect(formItem).toBeDefined();
      expect(formItem.subCategory).toBe('Graphics');
    });

    it('classifies ICC profiles as Color Profiles', async () => {
      const doc = await PDFDocument.create();
      doc.addPage();
      const iccData = new Uint8Array(200);
      iccData.fill(0);
      const dict = doc.context.obj({});
      dict.set(PDFName.of('N'), doc.context.obj(3));
      dict.set(PDFName.of('Alternate'), PDFName.of('DeviceRGB'));
      dict.set(PDFName.of('Length'), doc.context.obj(iccData.length));
      const stream = PDFRawStream.of(dict, iccData);
      doc.context.register(stream);

      const result = inspectDocument(doc);
      const other = result.categories.find((c) => c.label === 'Other Data');
      const iccItem = other.items.find((i) => i.displayName === 'ICC Color Profile');
      expect(iccItem).toBeDefined();
      expect(iccItem.subCategory).toBe('Color Profiles');
    });

    it('classifies CMapName dicts as Font Support / Unicode Mapping', async () => {
      const doc = await PDFDocument.create();
      doc.addPage();
      const cmapDict = doc.context.obj({});
      cmapDict.set(PDFName.of('CMapName'), PDFName.of('Adobe-Identity-UCS'));
      doc.context.register(cmapDict);

      const result = inspectDocument(doc);
      const other = result.categories.find((c) => c.label === 'Other Data');
      const cmapItem = other.items.find((i) => i.displayName === 'Unicode Mapping');
      expect(cmapItem).toBeDefined();
      expect(cmapItem.subCategory).toBe('Font Support');
    });

    it('classifies Annot type as Annotations', async () => {
      const doc = await PDFDocument.create();
      doc.addPage();
      const annotDict = doc.context.obj({});
      annotDict.set(PDFName.of('Type'), PDFName.of('Annot'));
      annotDict.set(PDFName.of('Subtype'), PDFName.of('Link'));
      doc.context.register(annotDict);

      const result = inspectDocument(doc);
      const other = result.categories.find((c) => c.label === 'Other Data');
      const annotItem = other.items.find((i) => i.displayName === 'Link Annotation');
      expect(annotItem).toBeDefined();
      expect(annotItem.subCategory).toBe('Annotations');
    });
  });
});

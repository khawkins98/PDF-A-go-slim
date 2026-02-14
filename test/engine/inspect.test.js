import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { inspectDocument } from '../../src/engine/inspect.js';
import { optimize } from '../../src/engine/pipeline.js';
import {
  createPdfWithEmbeddedStandardFont,
  createPdfWithFlatDecodeRgbImage,
  createMetadataBloatPdf,
  createPdfWithContentStreamText,
} from '../fixtures/create-test-pdfs.js';

describe('inspectDocument', () => {
  it('returns all 6 categories in fixed order', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    const result = inspectDocument(doc);

    expect(result.categories).toHaveLength(6);
    expect(result.categories.map((c) => c.label)).toEqual([
      'Fonts',
      'Images',
      'Content Streams',
      'Metadata',
      'Page Tree',
      'Other',
    ]);
  });

  it('classifies fonts', async () => {
    const doc = await createPdfWithEmbeddedStandardFont();
    const result = inspectDocument(doc);
    const fonts = result.categories.find((c) => c.label === 'Fonts');

    expect(fonts.count).toBeGreaterThan(0);
    // Should have at least a Font dict and a font file stream
    const fontDict = fonts.items.find((i) => i.name === 'Helvetica' && i.detail === 'Type1');
    expect(fontDict).toBeDefined();
    // Should also have a font file stream
    const fontFile = fonts.items.find((i) => i.detail === 'font file');
    expect(fontFile).toBeDefined();
    expect(fontFile.size).toBeGreaterThan(0);
  });

  it('classifies images with dimensions', async () => {
    const doc = await createPdfWithFlatDecodeRgbImage();
    const result = inspectDocument(doc);
    const images = result.categories.find((c) => c.label === 'Images');

    expect(images.count).toBeGreaterThan(0);
    expect(images.items.length).toBeGreaterThan(0);
    const img = images.items[0];
    expect(img.size).toBeGreaterThan(0);
    expect(img.detail).toContain('100x100');
    expect(img.detail).toContain('DeviceRGB');
  });

  it('classifies metadata', async () => {
    const doc = await createMetadataBloatPdf();
    const result = inspectDocument(doc);
    const metadata = result.categories.find((c) => c.label === 'Metadata');

    expect(metadata.count).toBeGreaterThan(0);
    expect(metadata.items.length).toBeGreaterThan(0);
  });

  it('classifies content streams with page numbers', async () => {
    const doc = await createPdfWithContentStreamText();
    const result = inspectDocument(doc);
    const content = result.categories.find((c) => c.label === 'Content Streams');

    expect(content.count).toBeGreaterThan(0);
    const pageItem = content.items.find((i) => i.name === 'Page 1');
    expect(pageItem).toBeDefined();
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
});

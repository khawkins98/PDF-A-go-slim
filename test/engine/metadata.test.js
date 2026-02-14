import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { stripMetadata } from '../../src/engine/optimize/metadata.js';
import { createMetadataBloatPdf, createMetadataBloatPdfWithLang } from '../fixtures/create-test-pdfs.js';

describe('stripMetadata', () => {
  it('removes XMP metadata from catalog', async () => {
    const doc = await createMetadataBloatPdf();

    // Verify XMP is present before stripping
    expect(doc.catalog.get(PDFName.of('Metadata'))).toBeDefined();

    const result = stripMetadata(doc);
    expect(result.stripped).toBeGreaterThan(0);

    // XMP should be gone
    expect(doc.catalog.get(PDFName.of('Metadata'))).toBeUndefined();
  });

  it('removes PieceInfo from pages', async () => {
    const doc = await createMetadataBloatPdf();
    const page = doc.getPage(0);

    // Verify PieceInfo is present
    expect(page.node.get(PDFName.of('PieceInfo'))).toBeDefined();

    stripMetadata(doc);

    // PieceInfo should be gone
    expect(page.node.get(PDFName.of('PieceInfo'))).toBeUndefined();
  });

  it('preserves Info dictionary', async () => {
    const doc = await createMetadataBloatPdf();
    stripMetadata(doc);

    // Title and author from /Info should still be accessible
    expect(doc.getTitle()).toBe('Test Document');
    expect(doc.getAuthor()).toBe('Test Author');
  });

  it('migrates dc:language from XMP to /Lang on catalog', async () => {
    const doc = await createMetadataBloatPdfWithLang();

    // /Lang should NOT be on catalog before stripping
    expect(doc.catalog.get(PDFName.of('Lang'))).toBeUndefined();

    stripMetadata(doc);

    // XMP is gone
    expect(doc.catalog.get(PDFName.of('Metadata'))).toBeUndefined();

    // /Lang should now be set on catalog
    const lang = doc.catalog.get(PDFName.of('Lang'));
    expect(lang).toBeDefined();
    expect(lang.decodeText()).toBe('en-US');
  });

  it('does not overwrite existing /Lang when stripping XMP', async () => {
    const doc = await createMetadataBloatPdfWithLang();
    // Pre-set a different /Lang
    doc.catalog.set(PDFName.of('Lang'), PDFString.of('de'));

    stripMetadata(doc);

    // Original /Lang should be preserved, not overwritten
    const lang = doc.catalog.get(PDFName.of('Lang'));
    expect(lang.decodeText()).toBe('de');
  });

  it('produces a valid PDF after stripping', async () => {
    const doc = await createMetadataBloatPdf();
    stripMetadata(doc);

    const bytes = await doc.save();
    const reloaded = await PDFDocument.load(bytes);
    expect(reloaded.getPageCount()).toBe(1);
  });
});

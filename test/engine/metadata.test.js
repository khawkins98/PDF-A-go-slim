import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName } from 'pdf-lib';
import { stripMetadata } from '../../src/engine/optimize/metadata.js';
import { createMetadataBloatPdf } from '../fixtures/create-test-pdfs.js';

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

  it('produces a valid PDF after stripping', async () => {
    const doc = await createMetadataBloatPdf();
    stripMetadata(doc);

    const bytes = await doc.save();
    const reloaded = await PDFDocument.load(bytes);
    expect(reloaded.getPageCount()).toBe(1);
  });
});

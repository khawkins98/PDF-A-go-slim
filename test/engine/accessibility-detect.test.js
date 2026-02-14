import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
  detectAccessibilityTraits,
  parseConformanceFromXmp,
} from '../../src/engine/utils/accessibility-detect.js';
import {
  createTaggedPdf,
  createPdfAPdf,
  createPdfUAPdf,
  createSimplePdf,
} from '../fixtures/create-test-pdfs.js';

describe('detectAccessibilityTraits', () => {
  it('detects tagged PDF with MarkInfo and StructTreeRoot', async () => {
    const doc = await createTaggedPdf();
    const traits = detectAccessibilityTraits(doc);

    expect(traits.isTagged).toBe(true);
    expect(traits.hasStructTree).toBe(true);
    expect(traits.lang).toBe('en-US');
    expect(traits.isPdfA).toBe(false);
    expect(traits.isPdfUA).toBe(false);
  });

  it('detects PDF/A-1b from XMP metadata', async () => {
    const doc = await createPdfAPdf();
    const traits = detectAccessibilityTraits(doc);

    expect(traits.isPdfA).toBe(true);
    expect(traits.pdfALevel).toBe('1B');
    expect(traits.isPdfUA).toBe(false);
  });

  it('detects PDF/UA from XMP metadata', async () => {
    const doc = await createPdfUAPdf();
    const traits = detectAccessibilityTraits(doc);

    expect(traits.isPdfUA).toBe(true);
    expect(traits.isTagged).toBe(true);
    expect(traits.hasStructTree).toBe(true);
    expect(traits.lang).toBe('en');
  });

  it('returns all false for a plain PDF', async () => {
    const doc = await createSimplePdf();
    const traits = detectAccessibilityTraits(doc);

    expect(traits.isTagged).toBe(false);
    expect(traits.isPdfA).toBe(false);
    expect(traits.isPdfUA).toBe(false);
    expect(traits.hasStructTree).toBe(false);
    expect(traits.pdfALevel).toBeNull();
    expect(traits.lang).toBeNull();
  });
});

describe('parseConformanceFromXmp', () => {
  it('parses element-style PDF/A declaration', () => {
    const xmp = new TextEncoder().encode(
      '<rdf:Description>' +
        '<pdfaid:part>2</pdfaid:part>' +
        '<pdfaid:conformance>A</pdfaid:conformance>' +
        '</rdf:Description>',
    );
    const result = parseConformanceFromXmp(xmp);

    expect(result.pdfAPart).toBe('2');
    expect(result.pdfAConformance).toBe('A');
    expect(result.pdfUAPart).toBeNull();
  });

  it('parses attribute-style PDF/A declaration', () => {
    const xmp = new TextEncoder().encode(
      '<rdf:Description pdfaid:part="3" pdfaid:conformance="B" />',
    );
    const result = parseConformanceFromXmp(xmp);

    expect(result.pdfAPart).toBe('3');
    expect(result.pdfAConformance).toBe('B');
  });

  it('parses element-style PDF/UA declaration', () => {
    const xmp = new TextEncoder().encode(
      '<rdf:Description>' +
        '<pdfuaid:part>1</pdfuaid:part>' +
        '</rdf:Description>',
    );
    const result = parseConformanceFromXmp(xmp);

    expect(result.pdfUAPart).toBe('1');
    expect(result.pdfAPart).toBeNull();
  });

  it('parses attribute-style PDF/UA declaration', () => {
    const xmp = new TextEncoder().encode(
      '<rdf:Description pdfuaid:part="2" />',
    );
    const result = parseConformanceFromXmp(xmp);

    expect(result.pdfUAPart).toBe('2');
  });

  it('parses combined PDF/A + PDF/UA', () => {
    const xmp = new TextEncoder().encode(
      '<rdf:Description>' +
        '<pdfaid:part>2</pdfaid:part>' +
        '<pdfaid:conformance>U</pdfaid:conformance>' +
        '<pdfuaid:part>1</pdfuaid:part>' +
        '</rdf:Description>',
    );
    const result = parseConformanceFromXmp(xmp);

    expect(result.pdfAPart).toBe('2');
    expect(result.pdfAConformance).toBe('U');
    expect(result.pdfUAPart).toBe('1');
  });

  it('returns nulls for XMP without conformance data', () => {
    const xmp = new TextEncoder().encode(
      '<x:xmpmeta><rdf:RDF><rdf:Description/></rdf:RDF></x:xmpmeta>',
    );
    const result = parseConformanceFromXmp(xmp);

    expect(result.pdfAPart).toBeNull();
    expect(result.pdfAConformance).toBeNull();
    expect(result.pdfUAPart).toBeNull();
  });
});

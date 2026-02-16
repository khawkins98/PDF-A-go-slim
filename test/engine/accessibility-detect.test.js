import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName, PDFString, PDFDict, PDFRef } from 'pdf-lib';
import {
  detectAccessibilityTraits,
  parseConformanceFromXmp,
  parseTitleFromXmp,
  auditAccessibility,
} from '../../src/engine/utils/accessibility-detect.js';
import {
  createTaggedPdf,
  createPdfAPdf,
  createPdfUAPdf,
  createSimplePdf,
  createPdfWithEmbeddedStandardFontAndToUnicode,
  createPdfWithEmbeddedStandardFont,
  createTaggedPdfWithFigureAlt,
  createPdfWithXmpTitle,
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

  it('detects title from Info dict', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    doc.setTitle('Info Dict Title');
    const traits = detectAccessibilityTraits(doc);

    expect(traits.title).toBe('Info Dict Title');
  });

  it('returns null title when not set', async () => {
    const doc = await createSimplePdf();
    const traits = detectAccessibilityTraits(doc);

    expect(traits.title).toBeNull();
  });

  it('detects title from XMP dc:title', async () => {
    const doc = await createPdfWithXmpTitle('My XMP Title');
    const traits = detectAccessibilityTraits(doc);

    expect(traits.title).toBe('My XMP Title');
  });

  it('prefers XMP title over Info dict title', async () => {
    const doc = await createPdfWithXmpTitle('XMP Title');
    doc.setTitle('Info Title');
    const traits = detectAccessibilityTraits(doc);

    expect(traits.title).toBe('XMP Title');
  });

  it('detects displayDocTitle: true', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    const vp = doc.context.obj({});
    vp.set(PDFName.of('DisplayDocTitle'), doc.context.obj(true));
    doc.catalog.set(PDFName.of('ViewerPreferences'), vp);
    const traits = detectAccessibilityTraits(doc);

    expect(traits.displayDocTitle).toBe(true);
  });

  it('detects displayDocTitle: false', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    const vp = doc.context.obj({});
    vp.set(PDFName.of('DisplayDocTitle'), doc.context.obj(false));
    doc.catalog.set(PDFName.of('ViewerPreferences'), vp);
    const traits = detectAccessibilityTraits(doc);

    expect(traits.displayDocTitle).toBe(false);
  });

  it('returns displayDocTitle: null when ViewerPreferences missing', async () => {
    const doc = await createSimplePdf();
    const traits = detectAccessibilityTraits(doc);

    expect(traits.displayDocTitle).toBeNull();
  });

  it('returns markedStatus: true for tagged PDF', async () => {
    const doc = await createTaggedPdf();
    const traits = detectAccessibilityTraits(doc);

    expect(traits.markedStatus).toBe('true');
  });

  it('returns markedStatus: false when MarkInfo has Marked false', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    const markInfo = doc.context.obj({});
    markInfo.set(PDFName.of('Marked'), doc.context.obj(false));
    doc.catalog.set(PDFName.of('MarkInfo'), markInfo);
    const traits = detectAccessibilityTraits(doc);

    expect(traits.markedStatus).toBe('false');
    expect(traits.isTagged).toBe(false);
  });

  it('returns markedStatus: missing for plain PDF', async () => {
    const doc = await createSimplePdf();
    const traits = detectAccessibilityTraits(doc);

    expect(traits.markedStatus).toBe('missing');
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

  it('returns null for XMP without dc:title', () => {
    const xmp = new TextEncoder().encode(
      '<x:xmpmeta><rdf:RDF><rdf:Description/></rdf:RDF></x:xmpmeta>',
    );
    expect(parseTitleFromXmp(xmp)).toBeNull();
  });

  it('extracts dc:title from XMP', () => {
    const xmp = new TextEncoder().encode(
      '<dc:title><rdf:Alt><rdf:li xml:lang="x-default">Hello World</rdf:li></rdf:Alt></dc:title>',
    );
    expect(parseTitleFromXmp(xmp)).toBe('Hello World');
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

describe('auditAccessibility', () => {
  it('detects font with ToUnicode CMap', async () => {
    const doc = await createPdfWithEmbeddedStandardFontAndToUnicode();
    // Save/reload so all objects materialize
    const saved = await doc.save();
    const reloaded = await PDFDocument.load(saved, { updateMetadata: false });
    const audit = auditAccessibility(reloaded);

    expect(audit.toUnicode.total).toBeGreaterThanOrEqual(1);
    const withCmap = audit.toUnicode.fonts.filter(f => f.hasToUnicode);
    expect(withCmap.length).toBeGreaterThanOrEqual(1);
  });

  it('detects font without ToUnicode CMap', async () => {
    const doc = await createPdfWithEmbeddedStandardFont();
    const saved = await doc.save();
    const reloaded = await PDFDocument.load(saved, { updateMetadata: false });
    const audit = auditAccessibility(reloaded);

    expect(audit.toUnicode.total).toBeGreaterThanOrEqual(1);
    const withoutCmap = audit.toUnicode.fonts.filter(f => !f.hasToUnicode);
    expect(withoutCmap.length).toBeGreaterThanOrEqual(1);
  });

  it('detects Figure with /Alt', async () => {
    const doc = await createTaggedPdfWithFigureAlt();
    const saved = await doc.save();
    const reloaded = await PDFDocument.load(saved, { updateMetadata: false });
    const audit = auditAccessibility(reloaded);

    expect(audit.imageAlt.figures).not.toBeNull();
    expect(audit.imageAlt.figures.withAlt).toBe(1);
  });

  it('detects Figure without /Alt', async () => {
    const doc = await createTaggedPdfWithFigureAlt();
    const saved = await doc.save();
    const reloaded = await PDFDocument.load(saved, { updateMetadata: false });
    const audit = auditAccessibility(reloaded);

    expect(audit.imageAlt.figures.withoutAlt).toBe(1);
  });

  it('returns null figures when no structure tree', async () => {
    const doc = await createSimplePdf();
    const saved = await doc.save();
    const reloaded = await PDFDocument.load(saved, { updateMetadata: false });
    const audit = auditAccessibility(reloaded);

    expect(audit.imageAlt.figures).toBeNull();
  });

  it('audits structure tree from createTaggedPdf', async () => {
    const doc = await createTaggedPdf();
    const saved = await doc.save();
    const reloaded = await PDFDocument.load(saved, { updateMetadata: false });
    const audit = auditAccessibility(reloaded);

    expect(audit.structureTree).not.toBeNull();
    expect(audit.structureTree.elementCount).toBe(2);
    expect(audit.structureTree.elementTypes).toContain('P');
    expect(audit.structureTree.elementTypes).toContain('H1');
  });

  it('returns null structure tree when none exists', async () => {
    const doc = await createSimplePdf();
    const saved = await doc.save();
    const reloaded = await PDFDocument.load(saved, { updateMetadata: false });
    const audit = auditAccessibility(reloaded);

    expect(audit.structureTree).toBeNull();
  });

  it('counts totalImages from image XObjects', async () => {
    const doc = await createTaggedPdfWithFigureAlt();
    const saved = await doc.save();
    const reloaded = await PDFDocument.load(saved, { updateMetadata: false });
    const audit = auditAccessibility(reloaded);

    expect(audit.imageAlt.totalImages).toBeGreaterThanOrEqual(1);
  });
});

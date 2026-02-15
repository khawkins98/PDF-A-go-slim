/**
 * Benchmark test suite — verifies full pipeline on realistic reference PDFs.
 *
 * Each describe block runs optimization once in beforeAll, then asserts many
 * properties: compression ratio, asset stripping, accessibility preservation.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { PDFDocument, PDFName } from 'pdf-lib';
import { optimize } from '../../src/engine/pipeline.js';
import {
  createIllustratorStylePdf,
  createPhotoHeavyPdf,
  createTaggedAccessiblePdf,
  createPdfA1bDocument,
  createMultiFontDuplicatesPdf,
  createKitchenSinkPdf,
  createCalRGBGraphicsPdf,
} from '../fixtures/create-benchmark-pdfs.js';
import {
  getEmbeddedFonts,
  getMetadataStatus,
  getStructureTreeInfo,
  getDocumentGeometry,
  getImageInfo,
  getColorSpaceInfo,
} from '../utils/pdf-verify.js';

// Helper to find a pass by name substring
function findPass(stats, nameSubstr) {
  return stats.passes.find((p) => p.name.includes(nameSubstr));
}

// --- Suite 1: Illustrator-style bloat ---

describe('Benchmark: Illustrator-style bloat', () => {
  let inputBytes, output, stats, outputDoc;

  beforeAll(async () => {
    inputBytes = await createIllustratorStylePdf();
    const result = await optimize(inputBytes);
    output = result.output;
    stats = result.stats;
    outputDoc = await PDFDocument.load(output, { updateMetadata: false });
  });

  it('achieves meaningful size reduction', () => {
    expect(stats.savedPercent).toBeGreaterThanOrEqual(30);
  });

  it('unembeds standard fonts', () => {
    const unembedPass = findPass(stats, 'Unembedding');
    expect(unembedPass.unembedded).toBeGreaterThanOrEqual(2);
  });

  it('strips metadata bloat keys', () => {
    const metadataPass = findPass(stats, 'Stripping');
    expect(metadataPass.stripped).toBeGreaterThanOrEqual(3);
  });

  it('removes XMP, PieceInfo, and Thumbnails from output', () => {
    const meta = getMetadataStatus(outputDoc);
    expect(meta.hasXmp).toBe(false);
    expect(meta.hasPieceInfo).toBe(false);
    expect(meta.hasThumbnails).toBe(false);
  });

  it('deduplicates streams', () => {
    const dedupPass = findPass(stats, 'Deduplicating objects');
    expect(dedupPass.deduplicated).toBeGreaterThanOrEqual(2);
  });

  it('removes orphan objects', () => {
    const unreferenced = findPass(stats, 'Removing');
    expect(unreferenced.removed).toBeGreaterThanOrEqual(3);
  });

  it('recompresses streams', () => {
    const streamsPass = findPass(stats, 'Recompressing streams');
    expect(streamsPass.recompressed).toBeGreaterThanOrEqual(1);
  });

  it('standard fonts have no FontFile in output', () => {
    const fonts = getEmbeddedFonts(outputDoc);
    const standardFonts = fonts.filter((f) =>
      ['Helvetica', 'Courier'].includes(f.name),
    );
    for (const font of standardFonts) {
      expect(font.hasFontFile).toBe(false);
    }
  });

  it('preserves page count and dimensions', () => {
    const inputDoc = PDFDocument.load(inputBytes, { updateMetadata: false });
    const geom = getDocumentGeometry(outputDoc);
    expect(geom.pageCount).toBe(1);
    expect(geom.pages[0].width).toBe(612);
    expect(geom.pages[0].height).toBe(792);
  });

  it('all passes report timing', () => {
    for (const pass of stats.passes) {
      if (!pass.error) {
        expect(pass._ms).toBeDefined();
        expect(typeof pass._ms).toBe('number');
      }
    }
  });
});

// --- Suite 2: Photo-heavy document ---

describe('Benchmark: Photo-heavy document', () => {
  let inputBytes, losslessOutput, losslessStats;

  beforeAll(async () => {
    inputBytes = await createPhotoHeavyPdf();
    const result = await optimize(inputBytes);
    losslessOutput = result.output;
    losslessStats = result.stats;
  });

  it('lossless: stream recompression fires', () => {
    const streamsPass = findPass(losslessStats, 'Recompressing streams');
    expect(streamsPass.recompressed).toBeGreaterThanOrEqual(1);
  });

  it('lossless: no image conversion', () => {
    const imagesPass = findPass(losslessStats, 'Recompressing images');
    expect(imagesPass.converted).toBe(0);
  });

  it('lossy: converts images and reduces size', async () => {
    const result = await optimize(inputBytes, {
      lossy: true,
      imageQuality: 0.75,
    });
    const imagesPass = findPass(result.stats, 'Recompressing images');
    expect(imagesPass.converted).toBeGreaterThanOrEqual(2);
    expect(result.stats.savedPercent).toBeGreaterThanOrEqual(20);
  });

  it('lossy + DPI cap: downsamples high-DPI image', async () => {
    const result = await optimize(inputBytes, {
      lossy: true,
      imageQuality: 0.75,
      maxImageDpi: 150,
    });
    const imagesPass = findPass(result.stats, 'Recompressing images');
    expect(imagesPass.downsampled).toBeGreaterThanOrEqual(1);
  });

  it('lossy: output images use DCTDecode', async () => {
    const result = await optimize(inputBytes, {
      lossy: true,
      imageQuality: 0.75,
    });
    const outDoc = await PDFDocument.load(result.output, { updateMetadata: false });
    const images = getImageInfo(outDoc);
    const convertedImages = images.filter((img) => img.filter === 'DCTDecode');
    expect(convertedImages.length).toBeGreaterThanOrEqual(2);
  });

  it('preserves page count', async () => {
    const doc = await PDFDocument.load(losslessOutput, { updateMetadata: false });
    const geom = getDocumentGeometry(doc);
    expect(geom.pageCount).toBe(2);
  });
});

// --- Suite 3: Tagged accessible PDF ---

describe('Benchmark: Tagged accessible PDF', () => {
  let inputBytes, output, stats, outputDoc, inputStructInfo;

  beforeAll(async () => {
    inputBytes = await createTaggedAccessiblePdf();
    const inputDoc = await PDFDocument.load(inputBytes, { updateMetadata: false });
    inputStructInfo = getStructureTreeInfo(inputDoc);

    const result = await optimize(inputBytes);
    output = result.output;
    stats = result.stats;
    outputDoc = await PDFDocument.load(output, { updateMetadata: false });
  });

  it('preserves StructTreeRoot', () => {
    const info = getStructureTreeInfo(outputDoc);
    expect(info.hasStructTree).toBe(true);
  });

  it('preserves MarkInfo and /Marked true', () => {
    const info = getStructureTreeInfo(outputDoc);
    expect(info.hasMarkInfo).toBe(true);
    expect(info.isMarked).toBe(true);
  });

  it('preserves /Lang as en-US', () => {
    const info = getStructureTreeInfo(outputDoc);
    expect(info.lang).toBe('en-US');
  });

  it('preserves StructElem count', () => {
    const info = getStructureTreeInfo(outputDoc);
    expect(info.structElemCount).toBe(inputStructInfo.structElemCount);
  });

  it('preserves StructElem types including P and H1', () => {
    const info = getStructureTreeInfo(outputDoc);
    expect(info.structElemTypes).toContain('P');
    expect(info.structElemTypes).toContain('H1');
  });

  it('still removes orphan objects', () => {
    const unreferenced = findPass(stats, 'Removing');
    expect(unreferenced.removed).toBeGreaterThanOrEqual(1);
  });

  it('stream recompression still works', () => {
    const streamsPass = findPass(stats, 'Recompressing streams');
    expect(streamsPass.recompressed).toBeGreaterThanOrEqual(1);
  });

  it('reports tagged PDF traits', () => {
    expect(stats.pdfTraits.isTagged).toBe(true);
    expect(stats.pdfTraits.hasStructTree).toBe(true);
  });
});

// --- Suite 4: PDF/A-1b document ---

describe('Benchmark: PDF/A-1b document', () => {
  let inputBytes, output, stats, outputDoc;

  beforeAll(async () => {
    inputBytes = await createPdfA1bDocument();
    const result = await optimize(inputBytes);
    output = result.output;
    stats = result.stats;
    outputDoc = await PDFDocument.load(output, { updateMetadata: false });
  });

  it('detects PDF/A conformance', () => {
    expect(stats.pdfTraits.isPdfA).toBe(true);
    expect(stats.pdfTraits.pdfALevel).toBe('1B');
  });

  it('preserves XMP metadata', () => {
    const meta = getMetadataStatus(outputDoc);
    expect(meta.hasXmp).toBe(true);
  });

  it('skips font unembedding', () => {
    const unembedPass = findPass(stats, 'Unembedding');
    expect(unembedPass.pdfaSkipped).toBe(true);
    expect(unembedPass.unembedded).toBe(0);
  });

  it('keeps Helvetica font file embedded', () => {
    const fonts = getEmbeddedFonts(outputDoc);
    const helvetica = fonts.find((f) => f.name === 'Helvetica');
    expect(helvetica).toBeDefined();
    expect(helvetica.hasFontFile).toBe(true);
  });

  it('still strips PieceInfo', () => {
    const meta = getMetadataStatus(outputDoc);
    expect(meta.hasPieceInfo).toBe(false);
  });

  it('does not use object streams (PDF/A-1 constraint)', () => {
    // Check raw bytes for /Type /ObjStm
    const outputStr = new TextDecoder('latin1').decode(output);
    expect(outputStr).not.toContain('/Type /ObjStm');
  });

  it('dedup still works', () => {
    const dedupPass = findPass(stats, 'Deduplicating objects');
    expect(dedupPass.deduplicated).toBeGreaterThanOrEqual(1);
  });

  it('unreferenced removal still works', () => {
    const unreferenced = findPass(stats, 'Removing');
    expect(unreferenced.removed).toBeGreaterThanOrEqual(1);
  });

  it('stream recompression still works', () => {
    const streamsPass = findPass(stats, 'Recompressing streams');
    expect(streamsPass.recompressed).toBeGreaterThanOrEqual(1);
  });
});

// --- Suite 5: Multi-font duplicates ---

describe('Benchmark: Multi-font duplicates', () => {
  let inputBytes, output, stats, outputDoc;

  beforeAll(async () => {
    inputBytes = await createMultiFontDuplicatesPdf();
    const result = await optimize(inputBytes);
    output = result.output;
    stats = result.stats;
    outputDoc = await PDFDocument.load(output, { updateMetadata: false });
  });

  it('unembeds all standard font instances', () => {
    const unembedPass = findPass(stats, 'Unembedding');
    expect(unembedPass.unembedded).toBeGreaterThanOrEqual(6);
  });

  it('MyCustomFont-Regular still has FontFile', () => {
    const fonts = getEmbeddedFonts(outputDoc);
    const custom = fonts.find((f) => f.name === 'MyCustomFont-Regular');
    expect(custom).toBeDefined();
    expect(custom.hasFontFile).toBe(true);
  });

  it('no standard fonts have FontFile in output', () => {
    const fonts = getEmbeddedFonts(outputDoc);
    const standardNames = ['Helvetica', 'Courier', 'Times-Roman'];
    const standardFonts = fonts.filter((f) => standardNames.includes(f.name));
    for (const font of standardFonts) {
      expect(font.hasFontFile).toBe(false);
    }
  });

  it('achieves meaningful size reduction', () => {
    expect(stats.savedPercent).toBeGreaterThanOrEqual(20);
  });
});

// --- Suite 6: Kitchen sink (integration benchmark) ---

describe('Benchmark: Kitchen sink', () => {
  let inputBytes, output, stats, outputDoc;

  beforeAll(async () => {
    inputBytes = await createKitchenSinkPdf();
    const result = await optimize(inputBytes);
    output = result.output;
    stats = result.stats;
    outputDoc = await PDFDocument.load(output, { updateMetadata: false });
  });

  it('lossless: achieves meaningful size reduction', () => {
    expect(stats.savedPercent).toBeGreaterThanOrEqual(5);
  });

  it('lossy: achieves >= 40% size reduction', async () => {
    const result = await optimize(inputBytes, {
      lossy: true,
      imageQuality: 0.75,
    });
    expect(result.stats.savedPercent).toBeGreaterThanOrEqual(40);
  });

  it('every pass reports stats without errors', () => {
    for (const pass of stats.passes) {
      expect(pass.error).toBeUndefined();
    }
  });

  it('inspect before and after both present', () => {
    expect(stats.inspect.before).toBeDefined();
    expect(stats.inspect.after).toBeDefined();
  });

  it('object count decreases', () => {
    expect(stats.inspect.after.objectCount).toBeLessThan(
      stats.inspect.before.objectCount,
    );
  });

  it('font category size decreases', () => {
    const fontsBefore = stats.inspect.before.categories.find(
      (c) => c.label === 'Fonts',
    );
    const fontsAfter = stats.inspect.after.categories.find(
      (c) => c.label === 'Fonts',
    );
    expect(fontsAfter.totalSize).toBeLessThan(fontsBefore.totalSize);
  });

  it('metadata category size decreases', () => {
    const metaBefore = stats.inspect.before.categories.find(
      (c) => c.label === 'Metadata',
    );
    const metaAfter = stats.inspect.after.categories.find(
      (c) => c.label === 'Metadata',
    );
    expect(metaAfter.totalSize).toBeLessThan(metaBefore.totalSize);
  });

  it('preserves all 4 pages with correct dimensions', () => {
    const geom = getDocumentGeometry(outputDoc);
    expect(geom.pageCount).toBe(4);
    // Page 1: US Letter
    expect(geom.pages[0].width).toBe(612);
    expect(geom.pages[0].height).toBe(792);
    // Page 2: 100x100
    expect(geom.pages[1].width).toBe(100);
    expect(geom.pages[1].height).toBe(100);
    // Page 3: US Letter
    expect(geom.pages[2].width).toBe(612);
    expect(geom.pages[2].height).toBe(792);
    // Page 4: US Letter
    expect(geom.pages[3].width).toBe(612);
    expect(geom.pages[3].height).toBe(792);
  });

  it('output is a valid reloadable PDF', async () => {
    const reloaded = await PDFDocument.load(output, { updateMetadata: false });
    expect(reloaded.getPageCount()).toBe(4);
  });
});

// --- Suite 7: CalRGB color space graphics ---

describe('Benchmark: CalRGB color space graphics', () => {
  let inputBytes, output, stats, outputDoc;

  beforeAll(async () => {
    inputBytes = await createCalRGBGraphicsPdf();
    const result = await optimize(inputBytes);
    output = result.output;
    stats = result.stats;
    outputDoc = await PDFDocument.load(output, { updateMetadata: false });
  });

  it('achieves some size reduction', () => {
    expect(stats.savedPercent).toBeGreaterThan(0);
    expect(stats.sizeGuard).toBeUndefined();
  });

  it('does not trigger content guard', () => {
    expect(stats.contentGuard).toBeUndefined();
    expect(stats.contentWarnings).toBeUndefined();
  });

  it('preserves page count and dimensions', () => {
    const geom = getDocumentGeometry(outputDoc);
    expect(geom.pageCount).toBe(1);
    expect(geom.pages[0].width).toBe(612);
    expect(geom.pages[0].height).toBe(792);
  });

  it('output is a valid reloadable PDF', async () => {
    const reloaded = await PDFDocument.load(output, { updateMetadata: false });
    expect(reloaded.getPageCount()).toBe(1);
  });

  it('preserves CalRGB and CalGray color space definitions', () => {
    const csInfo = getColorSpaceInfo(outputDoc);
    expect(csInfo.length).toBeGreaterThanOrEqual(3);
    const types = csInfo.map((cs) => cs.type);
    expect(types).toContain('CalRGB');
    expect(types).toContain('CalGray');
  });

  it('content stream survives optimization', () => {
    const page = outputDoc.getPages()[0];
    const contents = page.node.get(PDFName.of('Contents'));
    expect(contents).toBeDefined();
    // Verify the ref resolves to an actual object
    if (contents instanceof PDFName) {
      // Shouldn't happen, but guard
    } else {
      const resolved = outputDoc.context.lookup(contents);
      expect(resolved).toBeDefined();
    }
  });

  it('strips metadata (XMP and PieceInfo)', () => {
    const meta = getMetadataStatus(outputDoc);
    expect(meta.hasXmp).toBe(false);
    expect(meta.hasPieceInfo).toBe(false);
  });

  it('removes unreferenced objects', () => {
    const unreferenced = findPass(stats, 'Removing');
    expect(unreferenced.removed).toBeGreaterThanOrEqual(1);
  });

  it('all passes complete without errors', () => {
    for (const pass of stats.passes) {
      expect(pass.error).toBeUndefined();
    }
  });
});

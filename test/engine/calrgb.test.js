/**
 * Per-pass isolation test for CalRGB color space PDFs.
 *
 * Runs each optimization pass individually on a CalRGB fixture and verifies
 * that color space definitions and content streams survive. This pinpoints
 * which pass (if any) destroys CalRGB content.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { PDFDocument, PDFName, PDFRef } from 'pdf-lib';
import { createCalRGBGraphicsPdf } from '../fixtures/create-benchmark-pdfs.js';
import { getColorSpaceInfo } from '../utils/pdf-verify.js';

import { recompressStreams } from '../../src/engine/optimize/streams.js';
import { recompressImages } from '../../src/engine/optimize/images.js';
import { unembedStandardFonts } from '../../src/engine/optimize/font-unembed.js';
import { subsetFonts } from '../../src/engine/optimize/font-subset.js';
import { deduplicateObjects } from '../../src/engine/optimize/dedup.js';
import { deduplicateFonts } from '../../src/engine/optimize/fonts.js';
import { stripMetadata } from '../../src/engine/optimize/metadata.js';
import { removeUnreferencedObjects } from '../../src/engine/optimize/unreferenced.js';

const PASSES = [
  { name: 'streams', fn: recompressStreams },
  { name: 'images', fn: recompressImages },
  { name: 'font-unembed', fn: unembedStandardFonts },
  { name: 'font-subset', fn: subsetFonts },
  { name: 'dedup', fn: deduplicateObjects },
  { name: 'fonts', fn: deduplicateFonts },
  { name: 'metadata', fn: stripMetadata },
  { name: 'unreferenced', fn: removeUnreferencedObjects },
];

describe('CalRGB per-pass isolation', () => {
  let inputBytes;

  beforeAll(async () => {
    inputBytes = await createCalRGBGraphicsPdf();
  });

  for (const { name, fn } of PASSES) {
    it(`${name} preserves CalRGB content`, async () => {
      const pdfDoc = await PDFDocument.load(inputBytes, { updateMetadata: false });

      // Run the single pass
      await fn(pdfDoc, {});

      // Save and reload
      const savedBytes = await pdfDoc.save({ useObjectStreams: false });
      const reloaded = await PDFDocument.load(savedBytes, { updateMetadata: false });

      // Page must still exist
      expect(reloaded.getPageCount()).toBe(1);

      // Content stream must be present and resolvable
      const page = reloaded.getPages()[0];
      const contents = page.node.get(PDFName.of('Contents'));
      expect(contents).toBeDefined();
      if (contents instanceof PDFRef) {
        const resolved = reloaded.context.lookup(contents);
        expect(resolved).toBeDefined();
      }

      // Color spaces must survive
      const csInfo = getColorSpaceInfo(reloaded);
      expect(csInfo.length).toBeGreaterThanOrEqual(3);
      const types = csInfo.map((cs) => cs.type);
      expect(types).toContain('CalRGB');
      expect(types).toContain('CalGray');
    });
  }

  it('full pipeline preserves CalRGB content', async () => {
    const { optimize } = await import('../../src/engine/pipeline.js');
    const result = await optimize(inputBytes);

    expect(result.stats.contentGuard).toBeUndefined();

    const reloaded = await PDFDocument.load(result.output, { updateMetadata: false });
    expect(reloaded.getPageCount()).toBe(1);

    const csInfo = getColorSpaceInfo(reloaded);
    expect(csInfo.length).toBeGreaterThanOrEqual(3);
    const types = csInfo.map((cs) => cs.type);
    expect(types).toContain('CalRGB');
    expect(types).toContain('CalGray');
  });
});

/**
 * Optimization pipeline orchestrator.
 *
 * Loads a PDF, runs optimization passes in order, saves with compact settings.
 * Returns original bytes if output is not smaller (size guard).
 */
import { PDFDocument } from 'pdf-lib';
import { recompressStreams } from './optimize/streams.js';
import { recompressImages } from './optimize/images.js';
import { unembedStandardFonts } from './optimize/font-unembed.js';
import { subsetFonts } from './optimize/font-subset.js';
import { deduplicateObjects } from './optimize/dedup.js';
import { deduplicateFonts } from './optimize/fonts.js';
import { stripMetadata } from './optimize/metadata.js';
import { removeUnreferencedObjects } from './optimize/unreferenced.js';
import { inspectDocument } from './inspect.js';
import { detectAccessibilityTraits } from './utils/accessibility-detect.js';

const PASSES = [
  { name: 'Recompressing streams', fn: recompressStreams },
  { name: 'Recompressing images', fn: recompressImages },
  { name: 'Unembedding standard fonts', fn: unembedStandardFonts },
  { name: 'Subsetting fonts', fn: subsetFonts },
  { name: 'Deduplicating objects', fn: deduplicateObjects },
  { name: 'Deduplicating fonts', fn: deduplicateFonts },
  { name: 'Stripping metadata', fn: stripMetadata },
  { name: 'Removing unreferenced objects', fn: removeUnreferencedObjects },
];

/**
 * Optimize a PDF.
 *
 * @param {Uint8Array} inputBytes - Raw PDF bytes
 * @param {object} [options] - Reserved for future use
 * @param {function} [onProgress] - Progress callback (progress: 0-1, passName: string)
 * @returns {Promise<{ output: Uint8Array, stats: object }>}
 */
export async function optimize(inputBytes, options = {}, onProgress) {
  const inputSize = inputBytes.length;

  const pdfDoc = await PDFDocument.load(inputBytes, {
    updateMetadata: false,
  });

  const pdfTraits = detectAccessibilityTraits(pdfDoc);
  const passOptions = { ...options, _pdfTraits: pdfTraits };

  const stats = { inputSize, pdfTraits, passes: [] };
  const inspectBefore = inspectDocument(pdfDoc);

  for (let i = 0; i < PASSES.length; i++) {
    const { name, fn } = PASSES[i];
    if (onProgress) onProgress((i + 0.5) / PASSES.length, name);

    try {
      const t0 = Date.now();
      const passStats = await fn(pdfDoc, passOptions);
      stats.passes.push({ name, _ms: Date.now() - t0, ...passStats });
    } catch (err) {
      stats.passes.push({ name, error: err.message });
    }

    if (onProgress) onProgress((i + 1) / PASSES.length, name);
  }

  const inspectAfter = inspectDocument(pdfDoc);
  stats.inspect = { before: inspectBefore, after: inspectAfter };

  const outputBytes = await pdfDoc.save({
    useObjectStreams: true,
    addDefaultPage: false,
    updateFieldAppearances: false,
  });

  const output = new Uint8Array(outputBytes);
  stats.outputSize = output.length;
  stats.savedBytes = inputSize - output.length;
  stats.savedPercent =
    inputSize > 0
      ? parseFloat(((stats.savedBytes / inputSize) * 100).toFixed(1))
      : 0;

  // Size guard: never return a larger file
  if (output.length >= inputSize) {
    return {
      output: inputBytes instanceof Uint8Array ? inputBytes : new Uint8Array(inputBytes),
      stats: { ...stats, outputSize: inputSize, savedBytes: 0, savedPercent: 0, sizeGuard: true },
    };
  }

  return { output, stats };
}

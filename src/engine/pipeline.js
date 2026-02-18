/**
 * Optimization pipeline orchestrator.
 *
 * Loads a PDF, runs optimization passes in order, saves with compact settings.
 * Returns original bytes if output is not smaller (size guard).
 */
import { PDFDocument, PDFName, PDFRef, PDFArray, PDFString, PDFDict } from 'pdf-lib';
import { recompressStreams } from './optimize/streams.js';
import { recompressImages } from './optimize/images.js';
import { unembedStandardFonts } from './optimize/font-unembed.js';
import { subsetFonts } from './optimize/font-subset.js';
import { deduplicateObjects } from './optimize/dedup.js';
import { deduplicateFonts } from './optimize/fonts.js';
import { stripMetadata } from './optimize/metadata.js';
import { removeUnreferencedObjects } from './optimize/unreferenced.js';
import { inspectDocument } from './inspect.js';
import { detectAccessibilityTraits, auditAccessibility } from './utils/accessibility-detect.js';

/**
 * Lightweight post-pipeline integrity check.
 * Detects pages with missing or dangling content stream references —
 * a sign that the unreferenced pass (or another pass) removed live objects.
 */
function checkContentIntegrity(pdfDoc) {
  const warnings = [];
  const pages = pdfDoc.getPages();
  for (let i = 0; i < pages.length; i++) {
    const contents = pages[i].node.get(PDFName.of('Contents'));
    if (!contents) continue; // No content stream is valid (blank page)
    // Contents can be a single ref or an array of refs
    const refs = contents instanceof PDFArray
      ? Array.from({ length: contents.size() }, (_, j) => contents.get(j))
      : [contents];
    for (const ref of refs) {
      if (ref instanceof PDFRef && !pdfDoc.context.lookup(ref)) {
        warnings.push(`Page ${i + 1}: dangling content stream ref ${ref.tag}`);
      }
    }
  }
  return warnings;
}

/**
 * Embed optimization settings as custom Info dictionary entries.
 * Records the tool name, settings used, and a timestamp so the output
 * PDF carries provenance metadata about how it was optimized.
 */
function embedOptimizationMetadata(pdfDoc, options) {
  const parts = [];
  parts.push(options.lossy ? 'lossy' : 'lossless');
  if (options.lossy && options.imageQuality != null) {
    parts.push(`quality=${Math.round(options.imageQuality * 100)}%`);
  }
  if (options.lossy && options.maxImageDpi != null) {
    parts.push(`maxDPI=${options.maxImageDpi}`);
  }
  if (options.subsetFonts) parts.push('font-subset=on');
  if (options.unembedStandardFonts) parts.push('unembed-std-fonts=on');

  const settingsStr = parts.join(', ');
  const timestamp = new Date().toISOString();

  // Use the Info dictionary to store optimization provenance
  const infoRef = pdfDoc.context.trailerInfo.Info;
  let infoDict;
  if (infoRef) {
    infoDict = pdfDoc.context.lookup(infoRef);
  }
  if (!infoDict || !(infoDict instanceof PDFDict)) {
    infoDict = pdfDoc.context.obj({});
    pdfDoc.context.trailerInfo.Info = pdfDoc.context.register(infoDict);
  }

  infoDict.set(PDFName.of('OptimizedBy'), PDFString.of('PDF-A-go-slim'));
  infoDict.set(PDFName.of('OptimizationSettings'), PDFString.of(settingsStr));
  infoDict.set(PDFName.of('OptimizationDate'), PDFString.of(timestamp));
}

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

  stats.documentInfo = {
    pageCount: pdfDoc.getPages().length,
    title: pdfDoc.getTitle() || null,
    author: pdfDoc.getAuthor() || null,
    subject: pdfDoc.getSubject() || null,
    keywords: pdfDoc.getKeywords() || null,
    creator: pdfDoc.getCreator() || null,
    producer: pdfDoc.getProducer() || null,
    creationDate: pdfDoc.getCreationDate()?.toISOString() || null,
    modificationDate: pdfDoc.getModificationDate()?.toISOString() || null,
  };

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

  // Accessibility audit — runs on optimized document so report reflects downloadable output
  stats.accessibilityAudit = auditAccessibility(pdfDoc);

  // Content integrity check — detect content-destructive bugs
  const contentWarnings = checkContentIntegrity(pdfDoc);
  if (contentWarnings.length > 0) {
    stats.contentWarnings = contentWarnings;
    // Fall back to original bytes — don't return a broken PDF
    return {
      output: inputBytes instanceof Uint8Array ? inputBytes : new Uint8Array(inputBytes),
      stats: { ...stats, outputSize: inputSize, savedBytes: 0, savedPercent: 0, contentGuard: true },
    };
  }

  // Embed optimization settings metadata into the PDF Info dictionary
  embedOptimizationMetadata(pdfDoc, options);

  const outputBytes = await pdfDoc.save({
    useObjectStreams: !(pdfTraits.isPdfA && pdfTraits.pdfALevel?.startsWith('1')),
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

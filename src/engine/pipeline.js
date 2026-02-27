/**
 * Optimization pipeline orchestrator.
 *
 * Loads a PDF, runs optimization passes in order, saves with compact settings.
 * Returns original bytes if output is not smaller (size guard).
 */
import { PDFDocument, PDFName, PDFRef, PDFArray, PDFDict } from 'pdf-lib';
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
 * Collect all ref tags reachable from each page's /Contents and /Resources.
 * Returns a Map<pageNumber (1-based), Set<string>> of ref tags per page.
 */
function snapshotPageRefs(pdfDoc) {
  const context = pdfDoc.context;
  const pageMap = new Map();

  for (let i = 0; i < pdfDoc.getPages().length; i++) {
    const page = pdfDoc.getPages()[i];
    const refs = new Set();

    // Walk /Contents
    const contents = page.node.get(PDFName.of('Contents'));
    if (contents instanceof PDFRef) refs.add(contents.tag);
    else if (contents instanceof PDFArray) {
      for (let j = 0; j < contents.size(); j++) {
        const item = contents.get(j);
        if (item instanceof PDFRef) refs.add(item.tag);
      }
    }

    // Walk /Resources → Font, XObject, ExtGState, ColorSpace, Pattern, Shading
    let resources = page.node.get(PDFName.of('Resources'));
    if (resources instanceof PDFRef) {
      refs.add(resources.tag);
      resources = context.lookup(resources);
    }
    if (resources instanceof PDFDict) {
      for (const subDict of ['Font', 'XObject', 'ExtGState', 'ColorSpace', 'Pattern', 'Shading']) {
        let sub = resources.get(PDFName.of(subDict));
        if (sub instanceof PDFRef) {
          refs.add(sub.tag);
          sub = context.lookup(sub);
        }
        if (sub instanceof PDFDict) {
          for (const [, val] of sub.entries()) {
            if (val instanceof PDFRef) refs.add(val.tag);
          }
        }
      }
    }

    pageMap.set(i + 1, refs);
  }
  return pageMap;
}

/**
 * Compare page ref snapshots before/after a pass to find newly dangling refs.
 * Returns an array of warning strings, empty if all refs still resolve.
 */
function diffPageRefs(pdfDoc, before) {
  const context = pdfDoc.context;
  const warnings = [];
  for (const [pageNum, refTags] of before) {
    for (const tag of refTags) {
      // Reconstruct the PDFRef from its tag to check if the object still exists
      const parts = tag.split(' ');
      const ref = PDFRef.of(parseInt(parts[0], 10), parseInt(parts[1], 10));
      if (!context.lookup(ref)) {
        warnings.push(`Page ${pageNum}: dangling ref ${tag}`);
      }
    }
  }
  return warnings;
}

/**
 * Lightweight post-pipeline integrity check.
 * Detects pages with missing or dangling content stream references —
 * a sign that the unreferenced pass (or another pass) removed live objects.
 * Also checks that page resource refs (XObjects, fonts, etc.) still resolve.
 */
function checkContentIntegrity(pdfDoc) {
  const warnings = [];
  const context = pdfDoc.context;
  const pages = pdfDoc.getPages();
  for (let i = 0; i < pages.length; i++) {
    const contents = pages[i].node.get(PDFName.of('Contents'));
    if (!contents) continue; // No content stream is valid (blank page)
    // Contents can be a single ref or an array of refs
    const refs = contents instanceof PDFArray
      ? Array.from({ length: contents.size() }, (_, j) => contents.get(j))
      : [contents];
    for (const ref of refs) {
      if (ref instanceof PDFRef && !context.lookup(ref)) {
        warnings.push(`Page ${i + 1}: dangling content stream ref ${ref.tag}`);
      }
    }

    // Check page resource refs — Form XObjects, fonts, etc.
    let resources = pages[i].node.get(PDFName.of('Resources'));
    if (resources instanceof PDFRef) resources = context.lookup(resources);
    if (resources instanceof PDFDict) {
      for (const subDict of ['XObject', 'Font', 'ExtGState']) {
        let sub = resources.get(PDFName.of(subDict));
        if (sub instanceof PDFRef) sub = context.lookup(sub);
        if (sub instanceof PDFDict) {
          for (const [key, val] of sub.entries()) {
            if (val instanceof PDFRef && !context.lookup(val)) {
              const keyStr = key instanceof PDFName ? key.decodeText() : key.toString();
              warnings.push(`Page ${i + 1}: dangling ${subDict} ref ${val.tag} (/${keyStr})`);
            }
          }
        }
      }
    }
  }
  return warnings;
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

  // In debug mode, snapshot page refs before each pass to detect which pass
  // introduces dangling resource references (blank/broken pages).
  const debugResourceTracking = options.debug;

  for (let i = 0; i < PASSES.length; i++) {
    const { name, fn } = PASSES[i];
    if (onProgress) onProgress((i + 0.5) / PASSES.length, name);

    const refsBefore = debugResourceTracking ? snapshotPageRefs(pdfDoc) : null;

    try {
      const t0 = Date.now();
      const passStats = await fn(pdfDoc, passOptions);
      const entry = { name, _ms: Date.now() - t0, ...passStats };

      // Debug: check if this pass broke any page resource references
      if (refsBefore) {
        const dangling = diffPageRefs(pdfDoc, refsBefore);
        if (dangling.length > 0) {
          entry._danglingAfterPass = dangling;
        }
      }

      stats.passes.push(entry);
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

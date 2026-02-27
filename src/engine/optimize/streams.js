/**
 * Stream recompression pass.
 *
 * Iterates all indirect objects. For each PDFRawStream, decodes with our
 * decoders, recompresses with fflate zlibSync at level 9.
 * Only replaces if recompressed size < original. Skips image-native filters.
 */
import { zlibSync } from 'fflate';
import { PDFName, PDFRef, PDFDict, PDFArray, PDFRawStream } from 'pdf-lib';
import {
  decodeStream,
  hasImageFilter,
  allFiltersDecodable,
  getFilterNames,
} from '../utils/stream-decode.js';

export { getFilterNames };

/**
 * Check if a stream has DecodeParms that must be preserved.
 * Returns true if any DecodeParms entry contains Predictor > 1, or if
 * DecodeParms exists but we can't determine its contents (indirect ref
 * we can't resolve, unknown structure) — safe fallback is to keep it.
 */
function mustPreserveDecodeParms(dict, context) {
  let dp = dict.get(PDFName.of('DecodeParms'));
  if (!dp) return false;

  // Resolve indirect reference
  if (dp instanceof PDFRef) {
    dp = context.lookup(dp);
    if (!dp) return false;
  }

  // Single dict (most common: one filter → one DecodeParms dict)
  if (dp instanceof PDFDict) {
    return dictHasPredictor(dp, context);
  }

  // Array of dicts (one per filter in a multi-filter chain)
  if (dp instanceof PDFArray) {
    for (let i = 0; i < dp.size(); i++) {
      let item = dp.get(i);
      if (item instanceof PDFRef) item = context.lookup(item);
      if (item instanceof PDFDict && dictHasPredictor(item, context)) {
        return true;
      }
    }
    return false;
  }

  // Unknown structure — preserve to be safe
  return true;
}

/** Check if a single DecodeParms dict has Predictor > 1. */
function dictHasPredictor(dpDict, context) {
  let pred = dpDict.get(PDFName.of('Predictor'));
  if (!pred) return false;
  if (pred instanceof PDFRef) pred = context.lookup(pred);
  const val = Number(pred.toString());
  return val > 1;
}

/**
 * Recompress all eligible streams in the document.
 * @param {PDFDocument} pdfDoc
 * @param {object} [options]
 * @returns {{ recompressed: number, skipped: number, _debug?: Array }}
 */
export function recompressStreams(pdfDoc, options = {}) {
  const context = pdfDoc.context;
  const { debug = false } = options;
  const debugLog = debug ? [] : null;
  let recompressed = 0;
  let skipped = 0;

  for (const [ref, obj] of context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) {
      skipped++;
      continue;
    }

    const dict = obj.dict;
    const filters = getFilterNames(dict);

    // Skip image-native filters (JPEG, JPEG2000, CCITT, JBIG2)
    if (hasImageFilter(filters)) {
      skipped++;
      continue;
    }

    // Skip if we can't decode all filters
    if (filters && !allFiltersDecodable(filters)) {
      skipped++;
      continue;
    }

    // Check for DecodeParms that must survive recompression (Predictor,
    // or unknown structure we can't safely discard).
    const preserveDP = mustPreserveDecodeParms(dict, context);

    try {
      const rawBytes = obj.contents;

      // Decode through the filter pipeline
      const decoded = filters ? decodeStream(rawBytes, filters) : rawBytes;

      // Sanity check: if decoded output is dramatically smaller than the
      // raw compressed bytes, something went wrong in the decode chain.
      // A valid decode should produce >= the compressed size for any
      // compression filter (Flate, LZW). Skip to avoid replacing with garbage.
      if (filters && decoded.length < rawBytes.length * 0.5) {
        if (debugLog) {
          debugLog.push({
            ref: ref.toString(), action: 'skip', reason: 'suspicious-decode',
            message: `decoded ${decoded.length} bytes from ${rawBytes.length} raw (${(decoded.length / rawBytes.length * 100).toFixed(1)}%)`,
          });
        }
        skipped++;
        continue;
      }

      // Recompress with optimal deflate
      const recompressedBytes = zlibSync(decoded, { level: 9 });

      // Only replace if we saved space
      if (recompressedBytes.length < rawBytes.length) {
        if (debugLog && rawBytes.length > 500000) {
          debugLog.push({
            ref: ref.toString(), action: 'recompress',
            message: `${rawBytes.length} → ${recompressedBytes.length} bytes, filters=[${filters || 'none'}], preserveDP=${preserveDP}`,
          });
        }

        const newStream = PDFRawStream.of(dict, recompressedBytes);

        // Update filter to just FlateDecode
        dict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));

        // Preserve DecodeParms if the stream uses Predictor — our decode
        // only inflates, it does NOT reverse PNG/TIFF prediction. The
        // prediction bytes are still in the data and the viewer needs
        // DecodeParms to undo them. Deleting DecodeParms causes blank pages.
        if (!preserveDP) {
          dict.delete(PDFName.of('DecodeParms'));
        }

        // Update length
        dict.set(PDFName.of('Length'), context.obj(recompressedBytes.length));

        context.assign(ref, newStream);
        recompressed++;
      } else {
        skipped++;
      }
    } catch {
      // If decoding fails, leave the stream as-is
      skipped++;
    }
  }

  return { recompressed, skipped, ...(debugLog?.length > 0 && { _debug: debugLog }) };
}

/**
 * Stream recompression pass.
 *
 * Iterates all indirect objects. For each PDFRawStream, decodes with our
 * decoders, recompresses with fflate deflateSync at level 9.
 * Only replaces if recompressed size < original. Skips image-native filters.
 */
import { deflateSync } from 'fflate';
import { PDFName, PDFRawStream } from 'pdf-lib';
import {
  decodeStream,
  hasImageFilter,
  allFiltersDecodable,
  getFilterNames,
} from '../utils/stream-decode.js';

export { getFilterNames };

/**
 * Recompress all eligible streams in the document.
 * @param {PDFDocument} pdfDoc
 * @returns {{ recompressed: number, skipped: number }}
 */
export function recompressStreams(pdfDoc) {
  const context = pdfDoc.context;
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

    try {
      const rawBytes = obj.contents;

      // Decode through the filter pipeline
      const decoded = filters ? decodeStream(rawBytes, filters) : rawBytes;

      // Recompress with optimal deflate
      const recompressedBytes = deflateSync(decoded, { level: 9 });

      // Only replace if we saved space
      if (recompressedBytes.length < rawBytes.length) {
        const newStream = PDFRawStream.of(dict, recompressedBytes);

        // Update filter to just FlateDecode
        dict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
        // Remove DecodeParms (they belong to the old filter chain)
        dict.delete(PDFName.of('DecodeParms'));
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

  return { recompressed, skipped };
}

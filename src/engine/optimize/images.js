/**
 * Image recompression pass.
 *
 * Converts eligible FlateDecode raster images to JPEG.
 * Only active when options.lossy is true.
 * Skips: DCT/JPX (already JPEG), SMask (alpha), CMYK, non-8-bit,
 * non-simple ColorSpace, ImageMask, small images.
 */
import { PDFName, PDFRawStream, PDFArray } from 'pdf-lib';
import { encode as jpegEncode } from 'jpeg-js';
import { decodeStream, allFiltersDecodable } from '../utils/stream-decode.js';
import { undoPngPrediction } from '../utils/stream-decode.js';
import { getFilterNames } from './streams.js';

/** Minimum decoded pixel data size worth converting (10 KB). */
const MIN_DECODED_SIZE = 10 * 1024;

/** ColorSpace names we can handle. */
const SIMPLE_COLORSPACES = new Set([
  'DeviceRGB',
  'DeviceGray',
]);

/**
 * Check if a dict value is a PDFName matching one of the given names.
 */
function isNameIn(value, names) {
  if (!value) return false;
  if (value instanceof PDFName) {
    return names.has(value.decodeText());
  }
  return false;
}

/**
 * Get the simple color space name from a dict, or null if complex.
 */
function getSimpleColorSpace(dict) {
  const cs = dict.get(PDFName.of('ColorSpace'));
  if (!cs) return null;
  if (cs instanceof PDFName) {
    const name = cs.decodeText();
    return SIMPLE_COLORSPACES.has(name) ? name : null;
  }
  // Array-based colorspaces (ICCBased, Indexed, etc.) are not simple
  return null;
}

/**
 * Get DecodeParms dict from a stream dictionary.
 * Handles both single dict and array-of-dicts forms.
 */
function getDecodeParms(dict) {
  const dp = dict.get(PDFName.of('DecodeParms'));
  if (!dp) return null;
  // If it's an array, get the first entry
  if (dp instanceof PDFArray) {
    return dp.size() > 0 ? dp.get(0) : null;
  }
  return dp;
}

/**
 * Get a numeric value from a PDFDict.
 */
function getNumericValue(dict, key) {
  const val = dict.get(PDFName.of(key));
  if (!val) return undefined;
  if (typeof val.numberValue === 'function') return val.numberValue();
  if (typeof val.value === 'function') return val.value();
  // PDFNumber stores value directly
  if (val.numberValue !== undefined) return val.numberValue;
  if (val.value !== undefined) return Number(val.value);
  return undefined;
}

/**
 * Recompress eligible images as JPEG.
 * @param {PDFDocument} pdfDoc
 * @param {object} [options]
 * @param {boolean} [options.lossy=false] - Enable lossy optimizations
 * @param {number} [options.imageQuality=0.85] - JPEG quality 0-1
 * @returns {{ converted: number, skipped: number }}
 */
export function recompressImages(pdfDoc, options = {}) {
  const { lossy = false, imageQuality = 0.85 } = options;
  const context = pdfDoc.context;
  let converted = 0;
  let skipped = 0;

  // If lossy mode is off, skip everything
  if (!lossy) {
    return { converted: 0, skipped: 0 };
  }

  const quality = Math.round(Math.max(1, Math.min(100, imageQuality * 100)));

  for (const [ref, obj] of context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;

    const dict = obj.dict;

    // Must be an image XObject
    const subtype = dict.get(PDFName.of('Subtype'));
    if (!isNameIn(subtype, new Set(['Image']))) continue;

    // Skip ImageMask
    const imageMask = dict.get(PDFName.of('ImageMask'));
    if (imageMask && imageMask.toString() === 'true') {
      skipped++;
      continue;
    }

    // Skip images with SMask (alpha channel)
    if (dict.get(PDFName.of('SMask'))) {
      skipped++;
      continue;
    }

    // Check filters — skip if already DCT/JPX
    const filters = getFilterNames(dict);
    if (filters) {
      const hasImageNative = filters.some(
        (f) => f === 'DCTDecode' || f === 'DCT' || f === 'JPXDecode',
      );
      if (hasImageNative) {
        skipped++;
        continue;
      }
    }

    // Skip if filters aren't decodable
    if (filters && !allFiltersDecodable(filters)) {
      skipped++;
      continue;
    }

    // Must be 8-bit
    const bpc = getNumericValue(dict, 'BitsPerComponent');
    if (bpc !== undefined && bpc !== 8) {
      skipped++;
      continue;
    }

    // Must have a simple color space
    const colorSpace = getSimpleColorSpace(dict);
    if (!colorSpace) {
      skipped++;
      continue;
    }

    const width = getNumericValue(dict, 'Width');
    const height = getNumericValue(dict, 'Height');
    if (!width || !height) {
      skipped++;
      continue;
    }

    const components = colorSpace === 'DeviceRGB' ? 3 : 1;

    try {
      const rawBytes = obj.contents;

      // Decode through filter pipeline
      let decoded = filters ? decodeStream(rawBytes, filters) : rawBytes;

      // Check DecodeParms for PNG prediction
      const decodeParms = getDecodeParms(dict);
      if (decodeParms) {
        const predictor = getNumericValue(decodeParms, 'Predictor');
        if (predictor && predictor >= 10) {
          const columns =
            getNumericValue(decodeParms, 'Columns') || width;
          const colors =
            getNumericValue(decodeParms, 'Colors') || components;
          const bitsPerComp =
            getNumericValue(decodeParms, 'BitsPerComponent') || 8;
          const bytesPerPixel = (colors * bitsPerComp) / 8;
          decoded = undoPngPrediction(decoded, columns, bytesPerPixel);
        }
      }

      // Skip small images
      if (decoded.length < MIN_DECODED_SIZE) {
        skipped++;
        continue;
      }

      // Convert to RGBA for jpeg-js
      const pixelCount = width * height;
      const rgbaData = new Uint8Array(pixelCount * 4);

      if (components === 3) {
        // RGB → RGBA
        for (let i = 0; i < pixelCount; i++) {
          rgbaData[i * 4] = decoded[i * 3];
          rgbaData[i * 4 + 1] = decoded[i * 3 + 1];
          rgbaData[i * 4 + 2] = decoded[i * 3 + 2];
          rgbaData[i * 4 + 3] = 255;
        }
      } else {
        // Gray → RGBA
        for (let i = 0; i < pixelCount; i++) {
          rgbaData[i * 4] = decoded[i];
          rgbaData[i * 4 + 1] = decoded[i];
          rgbaData[i * 4 + 2] = decoded[i];
          rgbaData[i * 4 + 3] = 255;
        }
      }

      const jpegResult = jpegEncode(
        { data: rgbaData, width, height },
        quality,
      );
      const jpegBytes = new Uint8Array(jpegResult.data);

      // Only replace if JPEG is smaller
      if (jpegBytes.length >= rawBytes.length) {
        skipped++;
        continue;
      }

      // Update the stream
      const newStream = PDFRawStream.of(dict, jpegBytes);
      dict.set(PDFName.of('Filter'), PDFName.of('DCTDecode'));
      dict.delete(PDFName.of('DecodeParms'));
      dict.set(PDFName.of('Length'), context.obj(jpegBytes.length));
      context.assign(ref, newStream);
      converted++;
    } catch {
      skipped++;
    }
  }

  return { converted, skipped };
}

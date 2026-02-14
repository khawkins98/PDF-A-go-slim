/**
 * Image recompression pass.
 *
 * Converts eligible FlateDecode raster images to JPEG.
 * Only active when options.lossy is true.
 * Skips: DCT/JPX (already JPEG), SMask (alpha), CMYK, non-8-bit,
 * non-simple ColorSpace, ImageMask, small images.
 */
import { PDFName, PDFRawStream, PDFArray, PDFDict, PDFRef } from 'pdf-lib';
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
 * Build a map from image ref string → page dimensions (in points).
 * Walks all pages and their Resources → XObject dicts.
 * Used to estimate effective DPI for downsampling decisions.
 */
function buildImagePageMap(pdfDoc) {
  const map = new Map();
  const pages = pdfDoc.getPages();
  for (const page of pages) {
    const { width: pageW, height: pageH } = page.getSize();
    const resources = page.node.get(PDFName.of('Resources'));
    if (!resources || !(resources instanceof PDFDict)) continue;
    const xobjects = resources.get(PDFName.of('XObject'));
    if (!xobjects || !(xobjects instanceof PDFDict)) continue;

    const entries = xobjects.entries();
    for (const [, value] of entries) {
      if (value instanceof PDFRef) {
        const key = value.toString();
        // Keep the smallest page (conservative — highest DPI estimate)
        if (!map.has(key)) {
          map.set(key, { w: pageW, h: pageH });
        }
      }
    }
  }
  return map;
}

/**
 * Area-average (box filter) downsample RGBA pixel data.
 * For each destination pixel, averages all source pixels that map to it.
 */
function downsampleArea(rgba, srcW, srcH, dstW, dstH) {
  const out = new Uint8Array(dstW * dstH * 4);
  const xRatio = srcW / dstW;
  const yRatio = srcH / dstH;

  for (let dy = 0; dy < dstH; dy++) {
    const srcY0 = dy * yRatio;
    const srcY1 = (dy + 1) * yRatio;
    const sy0 = Math.floor(srcY0);
    const sy1 = Math.min(Math.ceil(srcY1), srcH);

    for (let dx = 0; dx < dstW; dx++) {
      const srcX0 = dx * xRatio;
      const srcX1 = (dx + 1) * xRatio;
      const sx0 = Math.floor(srcX0);
      const sx1 = Math.min(Math.ceil(srcX1), srcW);

      let r = 0, g = 0, b = 0, totalWeight = 0;

      for (let sy = sy0; sy < sy1; sy++) {
        // Vertical weight: fraction of this source row covered
        const wy = Math.min(sy + 1, srcY1) - Math.max(sy, srcY0);
        for (let sx = sx0; sx < sx1; sx++) {
          // Horizontal weight: fraction of this source col covered
          const wx = Math.min(sx + 1, srcX1) - Math.max(sx, srcX0);
          const w = wx * wy;
          const si = (sy * srcW + sx) * 4;
          r += rgba[si] * w;
          g += rgba[si + 1] * w;
          b += rgba[si + 2] * w;
          totalWeight += w;
        }
      }

      const di = (dy * dstW + dx) * 4;
      out[di]     = Math.round(r / totalWeight);
      out[di + 1] = Math.round(g / totalWeight);
      out[di + 2] = Math.round(b / totalWeight);
      out[di + 3] = 255;
    }
  }
  return out;
}

/**
 * Recompress eligible images as JPEG.
 * @param {PDFDocument} pdfDoc
 * @param {object} [options]
 * @param {boolean} [options.lossy=false] - Enable lossy optimizations
 * @param {number} [options.imageQuality=0.85] - JPEG quality 0-1
 * @param {number} [options.maxImageDpi] - Downsample images above this DPI
 * @returns {{ converted: number, skipped: number, downsampled: number }}
 */
export function recompressImages(pdfDoc, options = {}) {
  const { lossy = false, imageQuality = 0.85, maxImageDpi } = options;
  const context = pdfDoc.context;
  let converted = 0;
  let skipped = 0;
  let downsampled = 0;

  // If lossy mode is off, skip everything
  if (!lossy) {
    return { converted: 0, skipped: 0, downsampled: 0 };
  }

  const quality = Math.round(Math.max(1, Math.min(100, imageQuality * 100)));

  // Build page map for DPI estimation (only if downsampling is requested)
  const pageMap = maxImageDpi ? buildImagePageMap(pdfDoc) : null;

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
      let rgbaData = new Uint8Array(pixelCount * 4);

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

      // Downsample if above target DPI
      let outWidth = width;
      let outHeight = height;
      let didDownsample = false;

      if (pageMap && maxImageDpi) {
        const refStr = ref.toString();
        const pageDims = pageMap.get(refStr);
        if (pageDims) {
          const dpiX = (width * 72) / pageDims.w;
          const dpiY = (height * 72) / pageDims.h;
          const effectiveDpi = Math.min(dpiX, dpiY);

          if (effectiveDpi > maxImageDpi) {
            const scale = maxImageDpi / effectiveDpi;
            const newW = Math.max(1, Math.round(width * scale));
            const newH = Math.max(1, Math.round(height * scale));

            if (newW < width && newH < height) {
              rgbaData = downsampleArea(rgbaData, width, height, newW, newH);
              outWidth = newW;
              outHeight = newH;
              didDownsample = true;
            }
          }
        }
      }

      const jpegResult = jpegEncode(
        { data: rgbaData, width: outWidth, height: outHeight },
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

      // Update dimensions if downsampled
      if (didDownsample) {
        dict.set(PDFName.of('Width'), context.obj(outWidth));
        dict.set(PDFName.of('Height'), context.obj(outHeight));
        downsampled++;
      }

      context.assign(ref, newStream);
      converted++;
    } catch {
      skipped++;
    }
  }

  return { converted, skipped, downsampled };
}

/**
 * Image recompression pass.
 *
 * Converts eligible FlateDecode raster images to JPEG and re-encodes
 * existing DCTDecode (JPEG) images at the target quality/DPI.
 * Only active when options.lossy is true.
 * Skips: JPX (JPEG2000), SMask (alpha), CMYK, non-8-bit,
 * non-simple ColorSpace, ImageMask, small images.
 */
// jpeg-js encoder uses Buffer.from() to wrap its output. In a Vite-bundled
// Web Worker, `typeof module !== 'undefined'` (due to ESM shimming) so the
// encoder skips its Uint8Array path and calls Buffer.from(), which doesn't
// exist in browsers. Provide a minimal shim before importing.
if (typeof globalThis.Buffer === 'undefined') {
  globalThis.Buffer = {
    from: (arr) => new Uint8Array(arr),
    alloc: (size) => new Uint8Array(size),
  };
}

import { PDFName, PDFRawStream, PDFArray, PDFDict, PDFRef } from 'pdf-lib';
import { encode as jpegEncode, decode as jpegDecode } from 'jpeg-js';
import { decodeStream, allFiltersDecodable, undoPngPrediction, getFilterNames } from '../utils/stream-decode.js';

/**
 * Minimum decoded pixel data size worth converting (10 KB).
 * Below this threshold the JPEG header overhead often exceeds any savings
 * from lossy compression, so we skip small images entirely.
 */
const MIN_DECODED_SIZE = 10 * 1024;

/**
 * ColorSpace names we can safely convert to JPEG.
 * Only DeviceRGB and DeviceGray are handled because:
 * - CMYK requires color profile handling and jpeg-js doesn't support it
 * - ICCBased/Indexed/Lab colorspaces need profile-aware decoding
 * - DeviceGray is treated as single-component → expanded to RGBA for jpeg-js
 */
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
 *
 * Used to estimate effective DPI for downsampling decisions.
 * DPI is calculated as: (image pixels * 72) / page dimension in points.
 * The 72 factor comes from PDF's coordinate system where 1 point = 1/72 inch.
 *
 * When the same image appears on multiple pages, we keep the smallest page
 * dimensions (most conservative — yields the highest DPI estimate) to avoid
 * downsampling an image that would appear blurry on its smallest usage.
 *
 * @param {PDFDocument} pdfDoc
 * @returns {Map<string, {w: number, h: number}>} image ref → page dimensions
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
 *
 * For each destination pixel, computes a weighted average of all source pixels
 * that overlap its area. Fractional pixel coverage at boundaries is handled
 * via weight calculation: w = (overlap in X) * (overlap in Y).
 *
 * This produces higher quality than nearest-neighbor or bilinear for
 * downscaling, as it accounts for all source pixels contributing to each
 * output pixel rather than sampling a single point.
 *
 * @param {Uint8Array} rgba - Source RGBA pixel data
 * @param {number} srcW - Source width in pixels
 * @param {number} srcH - Source height in pixels
 * @param {number} dstW - Destination width in pixels
 * @param {number} dstH - Destination height in pixels
 * @returns {Uint8Array} Downsampled RGBA pixel data
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
  const { lossy = false, imageQuality = 0.85, maxImageDpi, debug = false } = options;
  const context = pdfDoc.context;
  let converted = 0;
  let skipped = 0;
  let downsampled = 0;
  const debugLog = debug ? [] : null;
  const skipReasons = debug ? { imageMask: 0, smask: 0, jpx: 0, filters: 0, bpc: 0, colorspace: 0, dimensions: 0, smallImage: 0, sizeGuard: 0, error: 0 } : null;

  // If lossy mode is off, skip everything
  if (!lossy) {
    return { converted: 0, skipped: 0, downsampled: 0, ...(debug && { _debug: [], skipReasons: {} }) };
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
      if (debugLog) { debugLog.push({ ref: ref.toString(), action: 'skip', reason: 'ImageMask' }); skipReasons.imageMask++; }
      skipped++;
      continue;
    }

    // Skip images with SMask (alpha channel)
    if (dict.get(PDFName.of('SMask'))) {
      if (debugLog) { debugLog.push({ ref: ref.toString(), action: 'skip', reason: 'SMask' }); skipReasons.smask++; }
      skipped++;
      continue;
    }

    // Check filters
    const filters = getFilterNames(dict);
    let isDCT = false;
    if (filters) {
      // JPXDecode (JPEG2000) — jpeg-js can't decode it
      if (filters.some((f) => f === 'JPXDecode')) {
        if (debugLog) { debugLog.push({ ref: ref.toString(), action: 'skip', reason: 'JPXDecode' }); skipReasons.jpx++; }
        skipped++;
        continue;
      }
      // DCTDecode — we can decode and re-encode at target quality
      isDCT = filters.some((f) => f === 'DCTDecode' || f === 'DCT');
      // Non-DCT: check that all filters are decodable
      if (!isDCT && !allFiltersDecodable(filters)) {
        if (debugLog) { debugLog.push({ ref: ref.toString(), action: 'skip', reason: 'non-decodable filters', filters }); skipReasons.filters++; }
        skipped++;
        continue;
      }
    }

    // For non-DCT images, verify BPC and colorspace (jpeg-js handles DCT internally)
    let components = 3;
    if (!isDCT) {
      const bpc = getNumericValue(dict, 'BitsPerComponent');
      if (bpc !== undefined && bpc !== 8) {
        if (debugLog) { debugLog.push({ ref: ref.toString(), action: 'skip', reason: 'BPC', bpc }); skipReasons.bpc++; }
        skipped++;
        continue;
      }

      const colorSpace = getSimpleColorSpace(dict);
      if (!colorSpace) {
        if (debugLog) { debugLog.push({ ref: ref.toString(), action: 'skip', reason: 'colorspace', value: dict.get(PDFName.of('ColorSpace'))?.toString() }); skipReasons.colorspace++; }
        skipped++;
        continue;
      }
      components = colorSpace === 'DeviceRGB' ? 3 : 1;
    }

    const width = getNumericValue(dict, 'Width');
    const height = getNumericValue(dict, 'Height');
    if (!width || !height) {
      if (debugLog) { debugLog.push({ ref: ref.toString(), action: 'skip', reason: 'no dimensions' }); skipReasons.dimensions++; }
      skipped++;
      continue;
    }

    try {
      const rawBytes = obj.contents;
      let rgbaData;
      let outWidth = width;
      let outHeight = height;

      if (isDCT) {
        // Decode JPEG to get raw pixel data
        const jpegResult = jpegDecode(rawBytes, { useTArray: true });
        rgbaData = jpegResult.data;
        // Use decoded dimensions (more reliable than dict for JPEG)
        outWidth = jpegResult.width;
        outHeight = jpegResult.height;

        // Skip small images
        if (rgbaData.length < MIN_DECODED_SIZE) {
          if (debugLog) { debugLog.push({ ref: ref.toString(), action: 'skip', reason: 'small image (DCT)', decodedSize: rgbaData.length }); skipReasons.smallImage++; }
          skipped++;
          continue;
        }
      } else {
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
          if (debugLog) { debugLog.push({ ref: ref.toString(), action: 'skip', reason: 'small image', decodedSize: decoded.length }); skipReasons.smallImage++; }
          skipped++;
          continue;
        }

        // Convert to RGBA for jpeg-js
        const pixelCount = width * height;
        rgbaData = new Uint8Array(pixelCount * 4);

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
      }

      // Downsample if above target DPI
      const imgW = outWidth;
      const imgH = outHeight;
      let didDownsample = false;

      if (pageMap && maxImageDpi) {
        const refStr = ref.toString();
        const pageDims = pageMap.get(refStr);
        if (pageDims) {
          const dpiX = (imgW * 72) / pageDims.w;
          const dpiY = (imgH * 72) / pageDims.h;
          const effectiveDpi = Math.min(dpiX, dpiY);

          if (effectiveDpi > maxImageDpi) {
            const scale = maxImageDpi / effectiveDpi;
            const newW = Math.max(1, Math.round(imgW * scale));
            const newH = Math.max(1, Math.round(imgH * scale));

            if (newW < imgW && newH < imgH) {
              rgbaData = downsampleArea(rgbaData, imgW, imgH, newW, newH);
              outWidth = newW;
              outHeight = newH;
              didDownsample = true;
            }
          }
        }
      }

      const encodedResult = jpegEncode(
        { data: rgbaData, width: outWidth, height: outHeight },
        quality,
      );
      const jpegBytes = new Uint8Array(encodedResult.data);

      // Only replace if JPEG is smaller
      if (jpegBytes.length >= rawBytes.length) {
        if (debugLog) { debugLog.push({ ref: ref.toString(), action: 'skip', reason: 'size guard', beforeSize: rawBytes.length, afterSize: jpegBytes.length }); skipReasons.sizeGuard++; }
        skipped++;
        continue;
      }

      if (debugLog) { debugLog.push({ ref: ref.toString(), action: 'convert', beforeSize: rawBytes.length, afterSize: jpegBytes.length, width: outWidth, height: outHeight, didDownsample }); }

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
    } catch (err) {
      if (debugLog) { debugLog.push({ ref: ref.toString(), action: 'skip', reason: 'error', message: err.message }); skipReasons.error++; }
      skipped++;
    }
  }

  return { converted, skipped, downsampled, ...(debugLog && { _debug: debugLog, skipReasons }) };
}

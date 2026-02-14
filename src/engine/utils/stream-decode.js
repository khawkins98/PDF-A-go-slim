/**
 * PDF stream decoders.
 *
 * Supports: FlateDecode, LZWDecode, ASCII85Decode, ASCIIHexDecode, RunLengthDecode.
 * Image-native filters (DCTDecode, JPXDecode, CCITTFaxDecode, JBIG2Decode) are
 * intentionally skipped — they should be passed through as-is.
 */
import { inflateSync, decompressSync } from 'fflate';
import { PDFName, PDFArray } from 'pdf-lib';

/**
 * Extract filter names from a stream's dictionary.
 * Returns an array of filter name strings, or null if no filters.
 */
export function getFilterNames(dict) {
  const filterEntry = dict.get(PDFName.of('Filter'));
  if (!filterEntry) return null;

  if (filterEntry instanceof PDFName) {
    return [filterEntry.decodeText()];
  }

  if (filterEntry instanceof PDFArray) {
    const names = [];
    for (let i = 0; i < filterEntry.size(); i++) {
      const item = filterEntry.get(i);
      if (item instanceof PDFName) {
        names.push(item.decodeText());
      }
    }
    return names;
  }

  return null;
}

/** Filters we can decode. */
const DECODABLE_FILTERS = new Set([
  'FlateDecode',
  'Fl', // abbreviation
  'LZWDecode',
  'LZW',
  'ASCII85Decode',
  'A85',
  'ASCIIHexDecode',
  'AHx',
  'RunLengthDecode',
  'RL',
]);

/** Filters that are image-native and should not be decoded/re-encoded. */
const IMAGE_FILTERS = new Set([
  'DCTDecode',
  'DCT',
  'JPXDecode',
  'CCITTFaxDecode',
  'CCF',
  'JBIG2Decode',
]);

/**
 * Returns true if the filter chain contains any image-native filter.
 */
export function hasImageFilter(filters) {
  if (!filters) return false;
  const arr = Array.isArray(filters) ? filters : [filters];
  return arr.some((f) => IMAGE_FILTERS.has(f));
}

/**
 * Returns true if all filters in the chain are decodable.
 */
export function allFiltersDecodable(filters) {
  if (!filters || filters.length === 0) return true;
  const arr = Array.isArray(filters) ? filters : [filters];
  return arr.every((f) => DECODABLE_FILTERS.has(f));
}

/**
 * Decode a stream through one filter.
 */
function decodeSingle(data, filterName) {
  switch (filterName) {
    case 'FlateDecode':
    case 'Fl':
      return decodeFlateDecode(data);
    case 'LZWDecode':
    case 'LZW':
      return decodeLZW(data);
    case 'ASCII85Decode':
    case 'A85':
      return decodeASCII85(data);
    case 'ASCIIHexDecode':
    case 'AHx':
      return decodeASCIIHex(data);
    case 'RunLengthDecode':
    case 'RL':
      return decodeRunLength(data);
    default:
      throw new Error(`Unsupported filter: ${filterName}`);
  }
}

/**
 * Decode a stream through a filter pipeline (array of filter names).
 * Filters are applied in order (first filter in array is applied first).
 */
export function decodeStream(rawBytes, filters) {
  if (!filters || filters.length === 0) return rawBytes;

  const arr = Array.isArray(filters) ? filters : [filters];
  let result = rawBytes instanceof Uint8Array ? rawBytes : new Uint8Array(rawBytes);

  for (const filter of arr) {
    result = decodeSingle(result, filter);
  }
  return result;
}

/**
 * Undo PNG row prediction (Predictor 10-15).
 * PNG prediction prepends a filter type byte to each row.
 * @param {Uint8Array} data - Decoded (inflated) data with prediction bytes
 * @param {number} columns - Pixels per row (from DecodeParms.Columns)
 * @param {number} components - Bytes per pixel (Colors * BitsPerComponent / 8)
 * @returns {Uint8Array} Raw pixel data without prediction
 */
export function undoPngPrediction(data, columns, components) {
  const bytesPerPixel = components;
  const bytesPerRow = columns * bytesPerPixel;
  const stride = bytesPerRow + 1; // +1 for filter type byte

  if (data.length % stride !== 0 && data.length >= stride) {
    // Try to determine actual row count from data length
  }

  const rows = Math.floor(data.length / stride);
  const output = new Uint8Array(rows * bytesPerRow);
  const prevRow = new Uint8Array(bytesPerRow); // starts as zeros

  for (let r = 0; r < rows; r++) {
    const srcOff = r * stride;
    const dstOff = r * bytesPerRow;
    const filterType = data[srcOff];

    for (let i = 0; i < bytesPerRow; i++) {
      const raw = data[srcOff + 1 + i];
      const a = i >= bytesPerPixel ? output[dstOff + i - bytesPerPixel] : 0; // left
      const b = prevRow[i]; // up
      const c = i >= bytesPerPixel ? prevRow[i - bytesPerPixel] : 0; // upper-left

      let val;
      switch (filterType) {
        case 0: // None
          val = raw;
          break;
        case 1: // Sub
          val = (raw + a) & 0xff;
          break;
        case 2: // Up
          val = (raw + b) & 0xff;
          break;
        case 3: // Average
          val = (raw + ((a + b) >>> 1)) & 0xff;
          break;
        case 4: // Paeth
          val = (raw + paethPredictor(a, b, c)) & 0xff;
          break;
        default:
          val = raw;
          break;
      }
      output[dstOff + i] = val;
    }

    // Copy current row to prevRow for next iteration
    prevRow.set(output.subarray(dstOff, dstOff + bytesPerRow));
  }

  return output;
}

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

// --- Individual decoders ---

function decodeFlateDecode(data) {
  try {
    return inflateSync(data);
  } catch {
    // Some zlib streams (e.g. from pako) need the full zlib wrapper handling
    return decompressSync(data);
  }
}

/**
 * LZW decoder for PDF streams (variable code width, MSB-first, early change).
 */
function decodeLZW(data) {
  const output = [];
  let bitPos = 0;
  const totalBits = data.length * 8;

  function readBits(n) {
    let result = 0;
    for (let i = 0; i < n; i++) {
      if (bitPos >= totalBits) return -1;
      const byteIdx = bitPos >> 3;
      const bitIdx = 7 - (bitPos & 7); // MSB first
      result = (result << 1) | ((data[byteIdx] >> bitIdx) & 1);
      bitPos++;
    }
    return result;
  }

  // Initialize table with single-byte entries
  const CLEAR_CODE = 256;
  const EOD_CODE = 257;
  let nextCode = 258;
  let codeSize = 9;

  let table = [];
  for (let i = 0; i < 256; i++) table[i] = [i];

  let prevEntry = null;

  while (bitPos < totalBits) {
    const code = readBits(codeSize);
    if (code === -1 || code === EOD_CODE) break;

    if (code === CLEAR_CODE) {
      // Reset
      table = [];
      for (let i = 0; i < 256; i++) table[i] = [i];
      nextCode = 258;
      codeSize = 9;
      prevEntry = null;
      continue;
    }

    let entry;
    if (code < nextCode) {
      entry = table[code];
    } else if (code === nextCode && prevEntry) {
      entry = [...prevEntry, prevEntry[0]];
    } else {
      break; // corrupted
    }

    output.push(...entry);

    if (prevEntry) {
      table[nextCode] = [...prevEntry, entry[0]];
      nextCode++;
      // PDF uses early code size change
      if (nextCode > (1 << codeSize) - 1 && codeSize < 12) {
        codeSize++;
      }
    }

    prevEntry = entry;
  }

  return new Uint8Array(output);
}

/**
 * ASCII85 (Base85) decoder.
 */
function decodeASCII85(data) {
  const output = [];
  let i = 0;
  const str =
    typeof data === 'string' ? data : String.fromCharCode.apply(null, data);

  // Skip leading whitespace and find content
  let input = str.replace(/\s/g, '');
  // Remove ~> end-of-data marker
  if (input.endsWith('~>')) input = input.slice(0, -2);

  let pos = 0;
  while (pos < input.length) {
    if (input[pos] === 'z') {
      // z = 4 zero bytes
      output.push(0, 0, 0, 0);
      pos++;
      continue;
    }

    const group = [];
    let count = 0;
    while (count < 5 && pos < input.length) {
      const ch = input.charCodeAt(pos);
      if (ch >= 33 && ch <= 117) {
        // '!' to 'u'
        group.push(ch - 33);
        count++;
      }
      pos++;
    }

    if (count === 0) break;

    // Pad with 'u' (84) for short final group
    while (group.length < 5) group.push(84);

    let value =
      group[0] * 52200625 + // 85^4
      group[1] * 614125 + // 85^3
      group[2] * 7225 + // 85^2
      group[3] * 85 +
      group[4];

    const bytes = [
      (value >> 24) & 0xff,
      (value >> 16) & 0xff,
      (value >> 8) & 0xff,
      value & 0xff,
    ];

    // Only output count-1 bytes for the last group
    const numBytes = count === 5 ? 4 : count - 1;
    for (let j = 0; j < numBytes; j++) {
      output.push(bytes[j]);
    }
  }

  return new Uint8Array(output);
}

/**
 * ASCIIHex decoder.
 */
function decodeASCIIHex(data) {
  const output = [];
  const str =
    typeof data === 'string' ? data : String.fromCharCode.apply(null, data);
  const hex = str.replace(/\s/g, '').replace(/>$/, '');

  for (let i = 0; i < hex.length; i += 2) {
    const pair = hex.slice(i, i + 2).padEnd(2, '0');
    output.push(parseInt(pair, 16));
  }

  return new Uint8Array(output);
}

/**
 * RunLength decoder.
 */
function decodeRunLength(data) {
  const output = [];
  let i = 0;

  while (i < data.length) {
    const length = data[i++];
    if (length === 128) break; // EOD
    if (length < 128) {
      // Copy next length+1 bytes
      const count = length + 1;
      for (let j = 0; j < count && i < data.length; j++) {
        output.push(data[i++]);
      }
    } else {
      // Repeat next byte (257-length) times
      const count = 257 - length;
      const byte = data[i++];
      for (let j = 0; j < count; j++) {
        output.push(byte);
      }
    }
  }

  return new Uint8Array(output);
}

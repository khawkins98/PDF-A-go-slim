import { describe, it, expect } from 'vitest';
import { PDFName, PDFArray } from 'pdf-lib';
import { deflateSync } from 'fflate';
import {
  decodeStream,
  hasImageFilter,
  allFiltersDecodable,
  undoPngPrediction,
  getFilterNames,
} from '../../src/engine/utils/stream-decode.js';

describe('getFilterNames', () => {
  it('returns null when no Filter entry exists', () => {
    const dict = new Map();
    const fakeDict = { get: (key) => dict.get(key.toString()) };
    expect(getFilterNames(fakeDict)).toBeNull();
  });

  it('returns single-element array for a PDFName filter', () => {
    const dict = new Map();
    dict.set('/Filter', PDFName.of('FlateDecode'));
    const fakeDict = { get: (key) => dict.get(key.toString()) };
    const result = getFilterNames(fakeDict);
    expect(result).toEqual(['FlateDecode']);
  });
});

describe('hasImageFilter', () => {
  it('returns false for null/undefined filters', () => {
    expect(hasImageFilter(null)).toBe(false);
    expect(hasImageFilter(undefined)).toBe(false);
  });

  it('returns false for decodable filters only', () => {
    expect(hasImageFilter(['FlateDecode'])).toBe(false);
    expect(hasImageFilter(['LZWDecode', 'FlateDecode'])).toBe(false);
  });

  it('returns true for image-native filters', () => {
    expect(hasImageFilter(['DCTDecode'])).toBe(true);
    expect(hasImageFilter(['JPXDecode'])).toBe(true);
    expect(hasImageFilter(['CCITTFaxDecode'])).toBe(true);
    expect(hasImageFilter(['JBIG2Decode'])).toBe(true);
  });

  it('returns true for abbreviated image filter names', () => {
    expect(hasImageFilter(['DCT'])).toBe(true);
    expect(hasImageFilter(['CCF'])).toBe(true);
  });

  it('handles single string (non-array) input', () => {
    expect(hasImageFilter('DCTDecode')).toBe(true);
    expect(hasImageFilter('FlateDecode')).toBe(false);
  });
});

describe('allFiltersDecodable', () => {
  it('returns true for empty or null filters', () => {
    expect(allFiltersDecodable(null)).toBe(true);
    expect(allFiltersDecodable([])).toBe(true);
  });

  it('returns true for known decodable filters', () => {
    expect(allFiltersDecodable(['FlateDecode'])).toBe(true);
    expect(allFiltersDecodable(['LZWDecode'])).toBe(true);
    expect(allFiltersDecodable(['ASCII85Decode'])).toBe(true);
    expect(allFiltersDecodable(['ASCIIHexDecode'])).toBe(true);
    expect(allFiltersDecodable(['RunLengthDecode'])).toBe(true);
  });

  it('returns true for abbreviated filter names', () => {
    expect(allFiltersDecodable(['Fl'])).toBe(true);
    expect(allFiltersDecodable(['LZW'])).toBe(true);
    expect(allFiltersDecodable(['A85'])).toBe(true);
    expect(allFiltersDecodable(['AHx'])).toBe(true);
    expect(allFiltersDecodable(['RL'])).toBe(true);
  });

  it('returns false for image-native filters', () => {
    expect(allFiltersDecodable(['DCTDecode'])).toBe(false);
    expect(allFiltersDecodable(['JPXDecode'])).toBe(false);
  });

  it('returns false if any filter is unknown', () => {
    expect(allFiltersDecodable(['FlateDecode', 'UnknownFilter'])).toBe(false);
  });
});

describe('FlateDecode', () => {
  it('round-trips deflate → decode', () => {
    const original = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const compressed = deflateSync(original, { level: 9 });
    const decoded = decodeStream(compressed, ['FlateDecode']);
    expect(decoded).toEqual(original);
  });

  it('handles abbreviated Fl filter name', () => {
    const original = new Uint8Array([42, 43, 44]);
    const compressed = deflateSync(original);
    const decoded = decodeStream(compressed, ['Fl']);
    expect(decoded).toEqual(original);
  });
});

describe('ASCII85Decode', () => {
  it('decodes known values', () => {
    // "Man " (4 bytes) in ASCII85 is "9jqo^"
    const encoded = new TextEncoder().encode('9jqo^~>');
    const decoded = decodeStream(encoded, ['ASCII85Decode']);
    expect(decoded).toEqual(new Uint8Array([77, 97, 110, 32])); // "Man "
  });

  it('handles z shorthand for four zero bytes', () => {
    const encoded = new TextEncoder().encode('z~>');
    const decoded = decodeStream(encoded, ['ASCII85Decode']);
    expect(decoded).toEqual(new Uint8Array([0, 0, 0, 0]));
  });
});

describe('ASCIIHexDecode', () => {
  it('decodes hex string to bytes', () => {
    const encoded = new TextEncoder().encode('48656C6C6F>');
    const decoded = decodeStream(encoded, ['ASCIIHexDecode']);
    expect(decoded).toEqual(new Uint8Array([0x48, 0x65, 0x6C, 0x6C, 0x6F])); // "Hello"
  });

  it('handles whitespace in hex data', () => {
    const encoded = new TextEncoder().encode('48 65 6C>');
    const decoded = decodeStream(encoded, ['ASCIIHexDecode']);
    expect(decoded).toEqual(new Uint8Array([0x48, 0x65, 0x6C]));
  });

  it('pads odd-length hex with zero', () => {
    const encoded = new TextEncoder().encode('ABC>');
    const decoded = decodeStream(encoded, ['ASCIIHexDecode']);
    // "ABC" → "AB" "C0"
    expect(decoded).toEqual(new Uint8Array([0xAB, 0xC0]));
  });
});

describe('RunLengthDecode', () => {
  it('decodes literal runs', () => {
    // length=2 means copy 3 bytes, then EOD (128)
    const encoded = new Uint8Array([2, 10, 20, 30, 128]);
    const decoded = decodeStream(encoded, ['RunLengthDecode']);
    expect(decoded).toEqual(new Uint8Array([10, 20, 30]));
  });

  it('decodes repeat runs', () => {
    // length=253 means repeat next byte (257-253)=4 times
    const encoded = new Uint8Array([253, 42, 128]);
    const decoded = decodeStream(encoded, ['RunLengthDecode']);
    expect(decoded).toEqual(new Uint8Array([42, 42, 42, 42]));
  });

  it('handles mixed literal and repeat runs', () => {
    // literal: len=1 → copy 2 bytes; repeat: len=254 → repeat 3 times; EOD
    const encoded = new Uint8Array([1, 65, 66, 254, 67, 128]);
    const decoded = decodeStream(encoded, ['RunLengthDecode']);
    expect(decoded).toEqual(new Uint8Array([65, 66, 67, 67, 67]));
  });
});

describe('LZWDecode', () => {
  it('decodes basic LZW-compressed data', () => {
    // Minimal LZW stream: CLEAR_CODE (256) + literal bytes + EOD (257)
    // We'll test via round-trip through a known encoded payload.
    // LZW with clear code, single bytes [65, 66, 67], then EOD.
    // Encoded manually (9-bit codes, MSB-first):
    // 256 (clear), 65, 66, 67, 257 (eod)
    // Bit-packed: 256=100000000, 65=001000001, 66=001000010, 67=001000011, 257=100000001
    const bits = '100000000' + '001000001' + '001000010' + '001000011' + '100000001';
    const padded = bits.padEnd(Math.ceil(bits.length / 8) * 8, '0');
    const bytes = [];
    for (let i = 0; i < padded.length; i += 8) {
      bytes.push(parseInt(padded.slice(i, i + 8), 2));
    }
    const decoded = decodeStream(new Uint8Array(bytes), ['LZWDecode']);
    expect(decoded).toEqual(new Uint8Array([65, 66, 67]));
  });
});

describe('decodeStream multi-filter chain', () => {
  it('applies filters in order', () => {
    // ASCIIHex → FlateDecode chain:
    // First deflate some data, then hex-encode it
    const original = new Uint8Array([100, 200, 50]);
    const deflated = deflateSync(original);
    // Hex-encode the deflated bytes
    const hexStr = Array.from(deflated).map(b => b.toString(16).padStart(2, '0')).join('') + '>';
    const hexBytes = new TextEncoder().encode(hexStr);

    const decoded = decodeStream(hexBytes, ['ASCIIHexDecode', 'FlateDecode']);
    expect(decoded).toEqual(original);
  });

  it('returns input unchanged for empty filter array', () => {
    const data = new Uint8Array([1, 2, 3]);
    expect(decodeStream(data, [])).toEqual(data);
  });

  it('returns input unchanged for null filters', () => {
    const data = new Uint8Array([1, 2, 3]);
    expect(decodeStream(data, null)).toEqual(data);
  });
});

describe('undoPngPrediction', () => {
  it('handles filter type 0 (None)', () => {
    // 2 pixels wide, 1 component, 2 rows
    // Row format: [filterType, ...pixels]
    const data = new Uint8Array([
      0, 10, 20, // row 0: None, px0=10, px1=20
      0, 30, 40, // row 1: None, px0=30, px1=40
    ]);
    const result = undoPngPrediction(data, 2, 1);
    expect(result).toEqual(new Uint8Array([10, 20, 30, 40]));
  });

  it('handles filter type 1 (Sub)', () => {
    // Sub: each byte += left neighbor
    // 2 pixels wide, 1 byte per pixel, 1 row
    const data = new Uint8Array([
      1, 10, 5, // row: Sub, raw0=10→out0=10, raw1=5→out1=10+5=15
    ]);
    const result = undoPngPrediction(data, 2, 1);
    expect(result).toEqual(new Uint8Array([10, 15]));
  });

  it('handles filter type 2 (Up)', () => {
    // Up: each byte += byte from previous row
    const data = new Uint8Array([
      0, 50, // row 0: None, px=50
      2, 10, // row 1: Up, raw=10→out=50+10=60
    ]);
    const result = undoPngPrediction(data, 1, 1);
    expect(result).toEqual(new Uint8Array([50, 60]));
  });

  it('handles filter type 4 (Paeth)', () => {
    // Paeth with a single pixel per row, 1 component
    // Row 0: None, value=100
    // Row 1: Paeth, raw=10 → Paeth(a=0, b=100, c=0) = 100 → out = (10+100) & 0xff = 110
    const data = new Uint8Array([
      0, 100,
      4, 10,
    ]);
    const result = undoPngPrediction(data, 1, 1);
    expect(result).toEqual(new Uint8Array([100, 110]));
  });
});

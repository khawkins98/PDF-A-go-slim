/**
 * Unicode mapper for font subsetting.
 *
 * Maps raw character codes (from content streams) to Unicode codepoints
 * that harfbuzzjs can use to subset the font.
 */
import { PDFName, PDFDict, PDFRef, PDFRawStream, PDFArray } from 'pdf-lib';
import { ADOBE_GLYPH_LIST, WIN_ANSI_ENCODING, MAC_ROMAN_ENCODING } from './glyph-list.js';
import { decodeStream, allFiltersDecodable } from './stream-decode.js';
import { getFilterNames } from '../optimize/streams.js';

/**
 * Map raw char code byte arrays to Unicode codepoints.
 *
 * @param {PDFDict} fontDict - The font dictionary
 * @param {Uint8Array[]} charCodeBuffers - Raw byte sequences from text operators
 * @param {object} context - PDF context for resolving refs
 * @returns {Set<number>} Unicode codepoints used by this font
 */
export function charCodesToUnicode(fontDict, charCodeBuffers, context) {
  const codepoints = new Set();

  const subtypeName = getFontSubtype(fontDict);

  if (subtypeName === 'Type0') {
    return mapType0(fontDict, charCodeBuffers, context);
  }

  // Simple font path (Type1, TrueType)
  return mapSimpleFont(fontDict, charCodeBuffers, context);
}

/**
 * Get font subtype name.
 */
function getFontSubtype(fontDict) {
  const subtype = fontDict.get(PDFName.of('Subtype'));
  if (subtype instanceof PDFName) return subtype.decodeText();
  return null;
}

/**
 * Check if a Type0 font uses Identity-H CMap and Identity CIDToGIDMap.
 */
export function isIdentityHFont(fontDict, context) {
  const encoding = fontDict.get(PDFName.of('Encoding'));
  if (!(encoding instanceof PDFName) || encoding.decodeText() !== 'Identity-H') {
    return false;
  }

  const descendants = fontDict.get(PDFName.of('DescendantFonts'));
  if (!(descendants instanceof PDFArray) || descendants.size() === 0) return false;

  let cidFont = descendants.get(0);
  if (cidFont instanceof PDFRef) cidFont = context.lookup(cidFont);
  if (!(cidFont instanceof PDFDict)) return false;

  const cidToGidMap = cidFont.get(PDFName.of('CIDToGIDMap'));
  if (!cidToGidMap) return true; // No map = Identity assumed
  if (cidToGidMap instanceof PDFName && cidToGidMap.decodeText() === 'Identity') return true;

  return false;
}

/**
 * Map simple font char codes to Unicode.
 *
 * Strategy:
 * 1. Read /Encoding → resolve to glyph names
 * 2. Glyph name → Unicode via Adobe Glyph List
 * 3. Override with /ToUnicode CMap if present
 */
function mapSimpleFont(fontDict, charCodeBuffers, context) {
  const codepoints = new Set();

  // Build charCode → glyph name table
  const glyphNames = buildGlyphNameTable(fontDict, context);

  // Try ToUnicode CMap first (highest priority)
  const toUnicodeMap = parseToUnicodeCMap(fontDict, context);

  // Collect all unique char codes
  const usedCodes = new Set();
  for (const buf of charCodeBuffers) {
    for (let i = 0; i < buf.length; i++) {
      usedCodes.add(buf[i]);
    }
  }

  for (const code of usedCodes) {
    // ToUnicode takes priority
    if (toUnicodeMap && toUnicodeMap.has(code)) {
      const uni = toUnicodeMap.get(code);
      if (Array.isArray(uni)) {
        for (const cp of uni) codepoints.add(cp);
      } else {
        codepoints.add(uni);
      }
      continue;
    }

    // Fall back to Encoding → AGL
    if (glyphNames[code]) {
      const glyphName = glyphNames[code];
      const cp = ADOBE_GLYPH_LIST.get(glyphName);
      if (cp !== undefined) {
        codepoints.add(cp);
        continue;
      }
      // Try uniXXXX naming convention
      const uniMatch = glyphName.match(/^uni([0-9A-Fa-f]{4})$/);
      if (uniMatch) {
        codepoints.add(parseInt(uniMatch[1], 16));
        continue;
      }
    }

    // Last resort: interpret charCode as Unicode directly
    // (works for ASCII range in most fonts)
    if (code >= 0x20 && code <= 0x7E) {
      codepoints.add(code);
    }
  }

  return codepoints;
}

/**
 * Build a charCode (0–255) → glyph name lookup from the font's Encoding.
 */
function buildGlyphNameTable(fontDict, context) {
  const table = new Array(256).fill(null);

  const encoding = fontDict.get(PDFName.of('Encoding'));

  if (!encoding) {
    // Default: StandardEncoding (approximate with WinAnsi for common coverage)
    for (let i = 0; i < 256; i++) {
      table[i] = WIN_ANSI_ENCODING[i] || null;
    }
    return table;
  }

  if (encoding instanceof PDFName) {
    const encName = encoding.decodeText();
    const base = getBaseEncoding(encName);
    for (let i = 0; i < 256; i++) {
      table[i] = base[i] || null;
    }
    return table;
  }

  if (encoding instanceof PDFDict || (encoding instanceof PDFRef)) {
    const encDict = encoding instanceof PDFRef ? context.lookup(encoding) : encoding;
    if (!(encDict instanceof PDFDict)) return table;

    // Start with base encoding
    const baseEncName = encDict.get(PDFName.of('BaseEncoding'));
    const base = (baseEncName instanceof PDFName)
      ? getBaseEncoding(baseEncName.decodeText())
      : WIN_ANSI_ENCODING;

    for (let i = 0; i < 256; i++) {
      table[i] = base[i] || null;
    }

    // Apply Differences array
    const diffs = encDict.get(PDFName.of('Differences'));
    if (diffs instanceof PDFArray) {
      let code = 0;
      for (let i = 0; i < diffs.size(); i++) {
        const item = diffs.get(i);
        if (typeof item === 'object' && item !== null) {
          if ('numberValue' in item) {
            code = typeof item.numberValue === 'function' ? item.numberValue() : item.numberValue;
          } else if (item instanceof PDFName) {
            table[code] = item.decodeText();
            code++;
          }
        }
      }
    }

    return table;
  }

  return table;
}

/**
 * Get a base encoding array by name.
 */
function getBaseEncoding(name) {
  switch (name) {
    case 'WinAnsiEncoding': return WIN_ANSI_ENCODING;
    case 'MacRomanEncoding': return MAC_ROMAN_ENCODING;
    default: return WIN_ANSI_ENCODING;
  }
}

/**
 * Map Type0/Identity-H font char codes to Unicode.
 *
 * For Identity-H fonts, each string contains 2-byte CIDs.
 * We parse the ToUnicode CMap to map CID → Unicode.
 */
function mapType0(fontDict, charCodeBuffers, context) {
  const codepoints = new Set();

  // Parse ToUnicode CMap
  const toUnicodeMap = parseToUnicodeCMap(fontDict, context);
  if (!toUnicodeMap || toUnicodeMap.size === 0) {
    // Without ToUnicode, we can't reliably map CIDs
    return codepoints;
  }

  // Extract 2-byte CIDs from char code buffers
  for (const buf of charCodeBuffers) {
    for (let i = 0; i + 1 < buf.length; i += 2) {
      const cid = (buf[i] << 8) | buf[i + 1];

      if (toUnicodeMap.has(cid)) {
        const uni = toUnicodeMap.get(cid);
        if (Array.isArray(uni)) {
          for (const cp of uni) codepoints.add(cp);
        } else {
          codepoints.add(uni);
        }
      }
    }
  }

  return codepoints;
}

/**
 * Parse a /ToUnicode CMap stream and return a Map<charCode, unicode>.
 *
 * Handles:
 * - beginbfchar / endbfchar (single mappings)
 * - beginbfrange / endbfrange (range mappings)
 */
function parseToUnicodeCMap(fontDict, context) {
  const toUnicodeRef = fontDict.get(PDFName.of('ToUnicode'));
  if (!toUnicodeRef) return null;

  let toUnicodeObj = toUnicodeRef;
  if (toUnicodeRef instanceof PDFRef) toUnicodeObj = context.lookup(toUnicodeRef);
  if (!(toUnicodeObj instanceof PDFRawStream)) return null;

  const filters = getFilterNames(toUnicodeObj.dict);
  let bytes;
  try {
    bytes = (filters && allFiltersDecodable(filters))
      ? decodeStream(toUnicodeObj.contents, filters)
      : toUnicodeObj.contents;
  } catch {
    return null;
  }

  const text = new TextDecoder('latin1').decode(bytes);
  return parseCMapText(text);
}

/**
 * Parse CMap text to extract char code → Unicode mappings.
 */
export function parseCMapText(text) {
  const map = new Map();

  // Parse beginbfchar sections
  const bfcharRe = /beginbfchar\s*([\s\S]*?)endbfchar/g;
  let match;
  while ((match = bfcharRe.exec(text)) !== null) {
    const lines = match[1].trim().split('\n');
    for (const line of lines) {
      const parts = line.trim().match(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/);
      if (parts) {
        const srcCode = parseInt(parts[1], 16);
        const unicode = parseUnicodeHex(parts[2]);
        map.set(srcCode, unicode);
      }
    }
  }

  // Parse beginbfrange sections
  const bfrangeRe = /beginbfrange\s*([\s\S]*?)endbfrange/g;
  while ((match = bfrangeRe.exec(text)) !== null) {
    const lines = match[1].trim().split('\n');
    for (const line of lines) {
      // Range: <start> <end> <dstStart>
      const rangeParts = line.trim().match(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/);
      if (rangeParts) {
        const start = parseInt(rangeParts[1], 16);
        const end = parseInt(rangeParts[2], 16);
        let dst = parseInt(rangeParts[3], 16);
        for (let code = start; code <= end; code++) {
          map.set(code, dst++);
        }
        continue;
      }

      // Range with array: <start> <end> [<dst1> <dst2> ...]
      const arrayParts = line.trim().match(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[(.*)\]/);
      if (arrayParts) {
        const start = parseInt(arrayParts[1], 16);
        const dsts = arrayParts[3].match(/<([0-9A-Fa-f]+)>/g) || [];
        for (let i = 0; i < dsts.length; i++) {
          const hexVal = dsts[i].replace(/[<>]/g, '');
          map.set(start + i, parseUnicodeHex(hexVal));
        }
      }
    }
  }

  return map;
}

/**
 * Parse a Unicode hex string. For 4-char strings, returns a single codepoint.
 * For longer strings (surrogate pairs / multi-char), returns an array.
 */
function parseUnicodeHex(hex) {
  if (hex.length <= 4) {
    return parseInt(hex, 16);
  }
  // Multi-char: split into 4-char chunks
  const codepoints = [];
  for (let i = 0; i < hex.length; i += 4) {
    codepoints.push(parseInt(hex.substring(i, i + 4), 16));
  }
  // Handle surrogate pairs
  const result = [];
  for (let i = 0; i < codepoints.length; i++) {
    const cp = codepoints[i];
    if (cp >= 0xD800 && cp <= 0xDBFF && i + 1 < codepoints.length) {
      const lo = codepoints[i + 1];
      if (lo >= 0xDC00 && lo <= 0xDFFF) {
        result.push(0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00));
        i++;
        continue;
      }
    }
    result.push(cp);
  }
  return result.length === 1 ? result[0] : result;
}

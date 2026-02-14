/**
 * Minimal PDF content stream tokenizer.
 *
 * Extracts text-related operations to build a map of
 * fontRef → Set<charCode bytes> for every font used in the document.
 */
import { PDFName, PDFDict, PDFArray, PDFRef, PDFRawStream } from 'pdf-lib';
import { decodeStream, allFiltersDecodable } from './stream-decode.js';
import { getFilterNames } from '../optimize/streams.js';

/**
 * Extract all character codes used per font across the entire document.
 *
 * @param {PDFDocument} pdfDoc
 * @returns {Map<string, { fontDict: PDFDict, charCodes: Uint8Array[] }>}
 *   Key is the font reference tag (e.g. "12 0"). charCodes are raw byte
 *   sequences from string operands — length depends on font type
 *   (1 byte for simple fonts, 2 bytes for CID fonts).
 */
export function extractUsedCharCodes(pdfDoc) {
  /** @type {Map<string, { fontDict: PDFDict, charCodes: Uint8Array[] }>} */
  const result = new Map();
  const pages = pdfDoc.getPages();

  for (const page of pages) {
    const resources = resolveDict(pdfDoc.context, page.node.get(PDFName.of('Resources')));
    const contentStreams = getContentStreams(pdfDoc.context, page.node);
    if (contentStreams.length === 0) continue;

    const bytes = concatStreams(pdfDoc.context, contentStreams);
    parseContentStream(pdfDoc.context, bytes, resources, result);
  }

  return result;
}

/**
 * Resolve a value to a PDFDict, following indirect references.
 */
function resolveDict(context, value) {
  if (!value) return null;
  if (value instanceof PDFRef) value = context.lookup(value);
  if (value instanceof PDFDict) return value;
  return null;
}

/**
 * Get content stream ref(s) from a page node.
 * Content can be a single stream ref or an array of stream refs.
 */
function getContentStreams(context, pageNode) {
  const contents = pageNode.get(PDFName.of('Contents'));
  if (!contents) return [];

  if (contents instanceof PDFRef) return [contents];

  if (contents instanceof PDFArray) {
    const refs = [];
    for (let i = 0; i < contents.size(); i++) {
      const item = contents.get(i);
      if (item instanceof PDFRef) refs.push(item);
    }
    return refs;
  }

  return [];
}

/**
 * Concatenate multiple content streams into one byte array.
 */
function concatStreams(context, refs) {
  const chunks = [];
  let totalLen = 0;

  for (const ref of refs) {
    const obj = context.lookup(ref);
    let bytes;

    if (obj instanceof PDFRawStream) {
      const filters = getFilterNames(obj.dict);
      try {
        bytes = (filters && allFiltersDecodable(filters))
          ? decodeStream(obj.contents, filters)
          : obj.contents;
      } catch {
        bytes = obj.contents;
      }
    } else if (obj && typeof obj.getUnencodedContents === 'function') {
      // PDFContentStream (pdf-lib internal type, used when content is created programmatically)
      try {
        bytes = obj.getUnencodedContents();
      } catch {
        continue;
      }
    } else {
      continue;
    }

    chunks.push(bytes);
    totalLen += bytes.length + 1; // +1 for space separator
  }

  if (chunks.length === 1) return chunks[0];

  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
    result[offset++] = 0x20; // space between streams
  }
  return result;
}

/**
 * Parse a content stream byte array, extracting text operations.
 *
 * Uses a simple stack-based approach: push operands, dispatch on operators.
 */
function parseContentStream(context, bytes, resources, result) {
  const len = bytes.length;
  let pos = 0;
  /** @type {any[]} */
  const stack = [];
  let currentFontRef = null;
  let currentFontDict = null;

  while (pos < len) {
    pos = skipWhitespace(bytes, pos, len);
    if (pos >= len) break;

    const ch = bytes[pos];

    // Literal string (...)
    if (ch === 0x28) {
      const str = parseLiteralString(bytes, pos, len);
      stack.push({ type: 'string', value: str.bytes });
      pos = str.end;
      continue;
    }

    // Hex string <...>
    if (ch === 0x3C && pos + 1 < len && bytes[pos + 1] !== 0x3C) {
      const str = parseHexString(bytes, pos, len);
      stack.push({ type: 'string', value: str.bytes });
      pos = str.end;
      continue;
    }

    // Dict marker << (skip, not relevant for text)
    if (ch === 0x3C && pos + 1 < len && bytes[pos + 1] === 0x3C) {
      pos += 2;
      continue;
    }

    // Dict end >>
    if (ch === 0x3E && pos + 1 < len && bytes[pos + 1] === 0x3E) {
      pos += 2;
      continue;
    }

    // Array [
    if (ch === 0x5B) {
      stack.push({ type: 'arrayStart' });
      pos++;
      continue;
    }

    // Array ]
    if (ch === 0x5D) {
      // Collect array items
      const items = [];
      while (stack.length > 0) {
        const top = stack[stack.length - 1];
        if (top.type === 'arrayStart') { stack.pop(); break; }
        items.unshift(stack.pop());
      }
      stack.push({ type: 'array', value: items });
      pos++;
      continue;
    }

    // Name /Something
    if (ch === 0x2F) {
      const name = parseName(bytes, pos, len);
      stack.push({ type: 'name', value: name.text });
      pos = name.end;
      continue;
    }

    // Number or keyword
    if (isRegularChar(ch)) {
      const token = parseToken(bytes, pos, len);

      if (isNumber(token.text)) {
        stack.push({ type: 'number', value: parseFloat(token.text) });
        pos = token.end;
        continue;
      }

      // It's a keyword (operator)
      pos = token.end;
      handleOperator(token.text, stack, context, resources, result, {
        get currentFontRef() { return currentFontRef; },
        get currentFontDict() { return currentFontDict; },
        set currentFontRef(v) { currentFontRef = v; },
        set currentFontDict(v) { currentFontDict = v; },
      });
      continue;
    }

    // Comment %
    if (ch === 0x25) {
      while (pos < len && bytes[pos] !== 0x0A && bytes[pos] !== 0x0D) pos++;
      continue;
    }

    // Skip unexpected bytes
    pos++;
  }
}

/**
 * Handle a PDF content stream operator.
 */
function handleOperator(op, stack, context, resources, result, state) {
  switch (op) {
    case 'Tf': {
      // stack: fontName fontSize Tf
      if (stack.length >= 2) {
        const fontSize = stack.pop();
        const fontName = stack.pop();
        if (fontName?.type === 'name') {
          const fontInfo = resolveFontFromResources(context, resources, fontName.value);
          if (fontInfo) {
            state.currentFontRef = fontInfo.refTag;
            state.currentFontDict = fontInfo.dict;
          }
        }
      }
      stack.length = 0;
      break;
    }
    case 'Tj': {
      // stack: string Tj
      if (stack.length >= 1) {
        const str = stack.pop();
        if (str?.type === 'string' && state.currentFontRef) {
          recordCharCodes(result, state.currentFontRef, state.currentFontDict, str.value);
        }
      }
      stack.length = 0;
      break;
    }
    case "'": {
      // stack: string '  (move to next line and show string)
      if (stack.length >= 1) {
        const str = stack.pop();
        if (str?.type === 'string' && state.currentFontRef) {
          recordCharCodes(result, state.currentFontRef, state.currentFontDict, str.value);
        }
      }
      stack.length = 0;
      break;
    }
    case '"': {
      // stack: aw ac string "  (set word/char spacing, show string)
      if (stack.length >= 3) {
        const str = stack.pop();
        stack.pop(); // ac
        stack.pop(); // aw
        if (str?.type === 'string' && state.currentFontRef) {
          recordCharCodes(result, state.currentFontRef, state.currentFontDict, str.value);
        }
      }
      stack.length = 0;
      break;
    }
    case 'TJ': {
      // stack: array TJ  (array of strings and numbers)
      if (stack.length >= 1) {
        const arr = stack.pop();
        if (arr?.type === 'array' && state.currentFontRef) {
          for (const item of arr.value) {
            if (item?.type === 'string') {
              recordCharCodes(result, state.currentFontRef, state.currentFontDict, item.value);
            }
          }
        }
      }
      stack.length = 0;
      break;
    }
    case 'Do': {
      // stack: name Do — invoke XObject
      if (stack.length >= 1) {
        const name = stack.pop();
        if (name?.type === 'name') {
          handleDoOperator(context, resources, name.value, result, state);
        }
      }
      stack.length = 0;
      break;
    }
    case 'BI': {
      // Inline image — skip until EI
      // BI <dict pairs> ID <data> EI
      // We don't need to parse this, just skip
      stack.length = 0;
      break;
    }
    default:
      // Unknown operator — clear stack
      stack.length = 0;
      break;
  }
}

/**
 * Handle Do operator: if the XObject is a Form, recurse into it.
 */
function handleDoOperator(context, resources, xobjName, result, state) {
  const xobjects = resolveDict(context, resources?.get(PDFName.of('XObject')));
  if (!xobjects) return;

  const xobjValue = xobjects.get(PDFName.of(xobjName));
  if (!xobjValue) return;

  const xobjRef = xobjValue instanceof PDFRef ? xobjValue : null;
  const xobj = xobjRef ? context.lookup(xobjRef) : xobjValue;

  if (!(xobj instanceof PDFRawStream)) return;

  const subtype = xobj.dict.get(PDFName.of('Subtype'));
  if (!(subtype instanceof PDFName) || subtype.decodeText() !== 'Form') return;

  // Get the Form XObject's own resources, falling back to the parent's
  const formResources = resolveDict(context, xobj.dict.get(PDFName.of('Resources'))) || resources;

  const filters = getFilterNames(xobj.dict);
  let bytes;
  try {
    bytes = (filters && allFiltersDecodable(filters))
      ? decodeStream(xobj.contents, filters)
      : xobj.contents;
  } catch {
    return;
  }

  parseContentStream(context, bytes, formResources, result);
}

/**
 * Resolve a font name from the page/form Resources/Font dict.
 * Returns { refTag, dict } or null.
 */
function resolveFontFromResources(context, resources, fontName) {
  if (!resources) return null;
  const fontDict = resolveDict(context, resources.get(PDFName.of('Font')));
  if (!fontDict) return null;

  const fontValue = fontDict.get(PDFName.of(fontName));
  if (!fontValue) return null;

  if (fontValue instanceof PDFRef) {
    const resolved = context.lookup(fontValue);
    if (resolved instanceof PDFDict) {
      return { refTag: fontValue.tag, dict: resolved };
    }
  } else if (fontValue instanceof PDFDict) {
    // Inline font dict (rare) — use a synthetic key
    return { refTag: `inline:${fontName}`, dict: fontValue };
  }
  return null;
}

/**
 * Record char code bytes for a font.
 */
function recordCharCodes(result, fontRefTag, fontDict, stringBytes) {
  if (!stringBytes || stringBytes.length === 0) return;

  let entry = result.get(fontRefTag);
  if (!entry) {
    entry = { fontDict, charCodes: [] };
    result.set(fontRefTag, entry);
  }
  entry.charCodes.push(new Uint8Array(stringBytes));
}

// --- Low-level tokenizer helpers ---

function skipWhitespace(bytes, pos, len) {
  while (pos < len) {
    const ch = bytes[pos];
    if (ch === 0x20 || ch === 0x09 || ch === 0x0A || ch === 0x0D || ch === 0x0C || ch === 0x00) {
      pos++;
    } else {
      break;
    }
  }
  return pos;
}

function parseLiteralString(bytes, startPos, len) {
  const result = [];
  let pos = startPos + 1; // skip opening '('
  let depth = 1;

  while (pos < len && depth > 0) {
    const ch = bytes[pos];
    if (ch === 0x5C) { // backslash escape
      pos++;
      if (pos >= len) break;
      const esc = bytes[pos];
      switch (esc) {
        case 0x6E: result.push(0x0A); pos++; break; // \n
        case 0x72: result.push(0x0D); pos++; break; // \r
        case 0x74: result.push(0x09); pos++; break; // \t
        case 0x62: result.push(0x08); pos++; break; // \b
        case 0x66: result.push(0x0C); pos++; break; // \f
        case 0x28: result.push(0x28); pos++; break; // \(
        case 0x29: result.push(0x29); pos++; break; // \)
        case 0x5C: result.push(0x5C); pos++; break; // \\
        case 0x0D: // line continuation \<CR> or \<CR><LF>
          pos++;
          if (pos < len && bytes[pos] === 0x0A) pos++;
          break;
        case 0x0A: // line continuation \<LF>
          pos++;
          break;
        default:
          // Octal escape
          if (esc >= 0x30 && esc <= 0x37) {
            let octal = esc - 0x30;
            if (pos + 1 < len && bytes[pos + 1] >= 0x30 && bytes[pos + 1] <= 0x37) {
              octal = octal * 8 + (bytes[++pos] - 0x30);
              if (pos + 1 < len && bytes[pos + 1] >= 0x30 && bytes[pos + 1] <= 0x37) {
                octal = octal * 8 + (bytes[++pos] - 0x30);
              }
            }
            result.push(octal & 0xFF);
            pos++;
          } else {
            result.push(esc);
            pos++;
          }
      }
    } else if (ch === 0x28) { // (
      depth++;
      result.push(ch);
      pos++;
    } else if (ch === 0x29) { // )
      depth--;
      if (depth > 0) result.push(ch);
      pos++;
    } else {
      result.push(ch);
      pos++;
    }
  }

  return { bytes: result, end: pos };
}

function parseHexString(bytes, startPos, len) {
  let pos = startPos + 1; // skip '<'
  const hexChars = [];

  while (pos < len && bytes[pos] !== 0x3E) { // >
    const ch = bytes[pos];
    // Skip whitespace within hex strings
    if (ch !== 0x20 && ch !== 0x09 && ch !== 0x0A && ch !== 0x0D && ch !== 0x0C) {
      hexChars.push(ch);
    }
    pos++;
  }
  if (pos < len) pos++; // skip closing '>'

  // Pad with trailing zero if odd number of hex digits
  if (hexChars.length % 2 !== 0) hexChars.push(0x30); // '0'

  const result = [];
  for (let i = 0; i < hexChars.length; i += 2) {
    const hi = hexDigit(hexChars[i]);
    const lo = hexDigit(hexChars[i + 1]);
    result.push((hi << 4) | lo);
  }

  return { bytes: result, end: pos };
}

function hexDigit(ch) {
  if (ch >= 0x30 && ch <= 0x39) return ch - 0x30;       // 0-9
  if (ch >= 0x41 && ch <= 0x46) return ch - 0x41 + 10;  // A-F
  if (ch >= 0x61 && ch <= 0x66) return ch - 0x61 + 10;  // a-f
  return 0;
}

function parseName(bytes, startPos, len) {
  let pos = startPos + 1; // skip '/'
  let text = '';

  while (pos < len) {
    const ch = bytes[pos];
    if (isDelimiter(ch) || isWhitespaceChar(ch)) break;
    // Handle #XX hex escapes in names
    if (ch === 0x23 && pos + 2 < len) {
      const hi = hexDigit(bytes[pos + 1]);
      const lo = hexDigit(bytes[pos + 2]);
      text += String.fromCharCode((hi << 4) | lo);
      pos += 3;
    } else {
      text += String.fromCharCode(ch);
      pos++;
    }
  }

  return { text, end: pos };
}

function parseToken(bytes, startPos, len) {
  let pos = startPos;
  let text = '';

  while (pos < len) {
    const ch = bytes[pos];
    if (isDelimiter(ch) || isWhitespaceChar(ch)) break;
    text += String.fromCharCode(ch);
    pos++;
  }

  return { text, end: pos };
}

function isWhitespaceChar(ch) {
  return ch === 0x20 || ch === 0x09 || ch === 0x0A || ch === 0x0D || ch === 0x0C || ch === 0x00;
}

function isDelimiter(ch) {
  return ch === 0x28 || ch === 0x29 || ch === 0x3C || ch === 0x3E ||
         ch === 0x5B || ch === 0x5D || ch === 0x7B || ch === 0x7D ||
         ch === 0x2F || ch === 0x25;
}

function isRegularChar(ch) {
  return !isWhitespaceChar(ch) && !isDelimiter(ch);
}

function isNumber(text) {
  return /^[+-]?(\d+\.?\d*|\.\d+)$/.test(text);
}

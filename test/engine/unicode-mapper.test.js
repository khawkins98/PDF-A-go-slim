import { describe, it, expect } from 'vitest';
import { PDFName, PDFDict, PDFDocument, PDFRawStream, PDFArray } from 'pdf-lib';
import { deflateSync } from 'fflate';
import { charCodesToUnicode, isIdentityHFont } from '../../src/engine/utils/unicode-mapper.js';
import { parseCMapText } from '../../src/engine/utils/unicode-mapper.js';

/**
 * Helper to create a simple font dict with a given encoding.
 */
function createSimpleFontDict(doc, { encoding, differences, toUnicodeText } = {}) {
  const fontDict = doc.context.obj({});
  fontDict.set(PDFName.of('Type'), PDFName.of('Font'));
  fontDict.set(PDFName.of('Subtype'), PDFName.of('TrueType'));
  fontDict.set(PDFName.of('BaseFont'), PDFName.of('TestFont'));

  if (encoding) {
    if (typeof encoding === 'string') {
      fontDict.set(PDFName.of('Encoding'), PDFName.of(encoding));
    } else {
      fontDict.set(PDFName.of('Encoding'), encoding);
    }
  }

  if (differences) {
    const encDict = doc.context.obj({});
    if (encoding && typeof encoding === 'string') {
      encDict.set(PDFName.of('BaseEncoding'), PDFName.of(encoding));
    }
    encDict.set(PDFName.of('Differences'), differences);
    fontDict.set(PDFName.of('Encoding'), doc.context.register(encDict));
  }

  if (toUnicodeText) {
    const toUnicodeBytes = new TextEncoder().encode(toUnicodeText);
    const toUnicodeDict = doc.context.obj({});
    toUnicodeDict.set(PDFName.of('Length'), doc.context.obj(toUnicodeBytes.length));
    const toUnicodeStream = PDFRawStream.of(toUnicodeDict, toUnicodeBytes);
    const toUnicodeRef = doc.context.register(toUnicodeStream);
    fontDict.set(PDFName.of('ToUnicode'), toUnicodeRef);
  }

  return fontDict;
}

describe('charCodesToUnicode', () => {
  it('maps WinAnsiEncoding: charCode 72 → U+0048 (H)', async () => {
    const doc = await PDFDocument.create();
    const fontDict = createSimpleFontDict(doc, { encoding: 'WinAnsiEncoding' });

    // charCode 72 = 'H'
    const charCodes = [new Uint8Array([72])];
    const result = charCodesToUnicode(fontDict, charCodes, doc.context);

    expect(result.has(0x0048)).toBe(true);
  });

  it('maps MacRomanEncoding', async () => {
    const doc = await PDFDocument.create();
    const fontDict = createSimpleFontDict(doc, { encoding: 'MacRomanEncoding' });

    // charCode 0x80 = Adieresis in MacRoman → U+00C4
    const charCodes = [new Uint8Array([0x80])];
    const result = charCodesToUnicode(fontDict, charCodes, doc.context);

    expect(result.has(0x00C4)).toBe(true);
  });

  it('handles Differences-based encoding', async () => {
    const doc = await PDFDocument.create();

    // Create a Differences array: at position 65, replace with 'Euro'
    const diffs = doc.context.obj([doc.context.obj(65), PDFName.of('Euro')]);

    const fontDict = createSimpleFontDict(doc, {
      encoding: 'WinAnsiEncoding',
      differences: diffs,
    });

    // charCode 65 → 'Euro' → U+20AC
    const charCodes = [new Uint8Array([65])];
    const result = charCodesToUnicode(fontDict, charCodes, doc.context);

    expect(result.has(0x20AC)).toBe(true);
  });

  it('handles multiple char codes', async () => {
    const doc = await PDFDocument.create();
    const fontDict = createSimpleFontDict(doc, { encoding: 'WinAnsiEncoding' });

    // "Hi" = charCodes [72, 105]
    const charCodes = [new Uint8Array([72, 105])];
    const result = charCodesToUnicode(fontDict, charCodes, doc.context);

    expect(result.has(0x0048)).toBe(true); // H
    expect(result.has(0x0069)).toBe(true); // i
  });
});

describe('parseCMapText', () => {
  it('parses beginbfchar mappings', () => {
    const cmapText = `
/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
2 beginbfchar
<0048> <0048>
<0065> <0065>
endbfchar
endcmap
`;
    const result = parseCMapText(cmapText);
    expect(result.get(0x48)).toBe(0x48);
    expect(result.get(0x65)).toBe(0x65);
  });

  it('parses beginbfrange mappings', () => {
    const cmapText = `
1 beginbfrange
<0041> <0043> <0041>
endbfrange
`;
    const result = parseCMapText(cmapText);
    expect(result.get(0x41)).toBe(0x41); // A
    expect(result.get(0x42)).toBe(0x42); // B
    expect(result.get(0x43)).toBe(0x43); // C
  });

  it('handles combined bfchar and bfrange', () => {
    const cmapText = `
1 beginbfchar
<0020> <0020>
endbfchar
1 beginbfrange
<0041> <005A> <0041>
endbfrange
`;
    const result = parseCMapText(cmapText);
    expect(result.get(0x20)).toBe(0x20); // space
    expect(result.get(0x41)).toBe(0x41); // A
    expect(result.get(0x5A)).toBe(0x5A); // Z
  });
});

describe('charCodesToUnicode - Type0/Identity-H', () => {
  it('maps 2-byte CIDs via ToUnicode CMap', async () => {
    const doc = await PDFDocument.create();

    const toUnicodeText = `
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
2 beginbfchar
<0048> <0048>
<0065> <0065>
endbfchar
`;

    // Create CIDFont descendant
    const cidFontDict = doc.context.obj({});
    cidFontDict.set(PDFName.of('Type'), PDFName.of('Font'));
    cidFontDict.set(PDFName.of('Subtype'), PDFName.of('CIDFontType2'));
    cidFontDict.set(PDFName.of('CIDToGIDMap'), PDFName.of('Identity'));
    const cidFontRef = doc.context.register(cidFontDict);

    // Create Type0 font
    const fontDict = doc.context.obj({});
    fontDict.set(PDFName.of('Type'), PDFName.of('Font'));
    fontDict.set(PDFName.of('Subtype'), PDFName.of('Type0'));
    fontDict.set(PDFName.of('Encoding'), PDFName.of('Identity-H'));
    fontDict.set(PDFName.of('DescendantFonts'), doc.context.obj([cidFontRef]));

    // Add ToUnicode
    const toUnicodeBytes = new TextEncoder().encode(toUnicodeText);
    const toUnicodeDict = doc.context.obj({});
    toUnicodeDict.set(PDFName.of('Length'), doc.context.obj(toUnicodeBytes.length));
    const toUnicodeStream = PDFRawStream.of(toUnicodeDict, toUnicodeBytes);
    const toUnicodeRef = doc.context.register(toUnicodeStream);
    fontDict.set(PDFName.of('ToUnicode'), toUnicodeRef);

    // 2-byte char codes: CID 0x0048 and 0x0065
    const charCodes = [new Uint8Array([0x00, 0x48, 0x00, 0x65])];
    const result = charCodesToUnicode(fontDict, charCodes, doc.context);

    expect(result.has(0x0048)).toBe(true);
    expect(result.has(0x0065)).toBe(true);
  });

  it('returns empty set when ToUnicode is missing for Type0', async () => {
    const doc = await PDFDocument.create();

    const cidFontDict = doc.context.obj({});
    cidFontDict.set(PDFName.of('Type'), PDFName.of('Font'));
    cidFontDict.set(PDFName.of('Subtype'), PDFName.of('CIDFontType2'));
    const cidFontRef = doc.context.register(cidFontDict);

    const fontDict = doc.context.obj({});
    fontDict.set(PDFName.of('Type'), PDFName.of('Font'));
    fontDict.set(PDFName.of('Subtype'), PDFName.of('Type0'));
    fontDict.set(PDFName.of('Encoding'), PDFName.of('Identity-H'));
    fontDict.set(PDFName.of('DescendantFonts'), doc.context.obj([cidFontRef]));
    // No ToUnicode

    const charCodes = [new Uint8Array([0x00, 0x48])];
    const result = charCodesToUnicode(fontDict, charCodes, doc.context);

    expect(result.size).toBe(0);
  });
});

describe('isIdentityHFont', () => {
  it('returns true for Identity-H with Identity CIDToGIDMap', async () => {
    const doc = await PDFDocument.create();

    const cidFontDict = doc.context.obj({});
    cidFontDict.set(PDFName.of('CIDToGIDMap'), PDFName.of('Identity'));
    const cidFontRef = doc.context.register(cidFontDict);

    const fontDict = doc.context.obj({});
    fontDict.set(PDFName.of('Encoding'), PDFName.of('Identity-H'));
    fontDict.set(PDFName.of('DescendantFonts'), doc.context.obj([cidFontRef]));

    expect(isIdentityHFont(fontDict, doc.context)).toBe(true);
  });

  it('returns false for non-Identity-H encoding', async () => {
    const doc = await PDFDocument.create();

    const fontDict = doc.context.obj({});
    fontDict.set(PDFName.of('Encoding'), PDFName.of('UniJIS-UTF16-H'));

    expect(isIdentityHFont(fontDict, doc.context)).toBe(false);
  });
});

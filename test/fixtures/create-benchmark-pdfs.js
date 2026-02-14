/**
 * Reference PDF generators for benchmark tests.
 *
 * Each function returns Uint8Array (saved bytes) to match the pipeline's
 * optimize(inputBytes) contract. These are more complex than unit-test
 * fixtures — each combines multiple bloat vectors for realistic testing.
 */
import {
  PDFDocument,
  PDFName,
  PDFDict,
  PDFArray,
  PDFString,
  PDFRawStream,
  PDFRef,
  StandardFonts,
} from 'pdf-lib';
import { deflateSync } from 'fflate';
import { encode as jpegEncode } from 'jpeg-js';

// --- Shared helpers ---

/** Generate smooth sine-wave RGB pixel data (photo-like, per project conventions). */
function generateSinePixels(width, height, components = 3) {
  const pixels = new Uint8Array(width * height * components);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * components;
      const xf = x / width;
      const yf = y / height;
      pixels[idx] = Math.round(127 + 127 * Math.sin(xf * 7.3 + yf * 2.1));
      if (components >= 2) pixels[idx + 1] = Math.round(127 + 127 * Math.sin(yf * 5.7 + xf * 3.9));
      if (components >= 3) pixels[idx + 2] = Math.round(127 + 127 * Math.sin((xf + yf) * 4.1));
    }
  }
  return pixels;
}

/** Generate sine-wave RGBA data for JPEG encoding. */
function generateSineRgba(width, height) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const xf = x / width;
      const yf = y / height;
      data[idx]     = Math.round(127 + 127 * Math.sin(xf * 7.3 + yf * 2.1));
      data[idx + 1] = Math.round(127 + 127 * Math.sin(yf * 5.7 + xf * 3.9));
      data[idx + 2] = Math.round(127 + 127 * Math.sin((xf + yf) * 4.1));
      data[idx + 3] = 255;
    }
  }
  return data;
}

/** Create a fake font file (TrueType program bytes) and return compressed + raw length. */
function createFakeFontFile(size = 50000) {
  const data = new Uint8Array(size);
  for (let i = 0; i < data.length; i++) data[i] = i % 256;
  const compressed = deflateSync(data, { level: 1 });
  return { compressed, rawLength: data.length };
}

/** Register an embedded standard font (Type1 with FontFile2) on a page. */
function addEmbeddedStandardFont(doc, page, fontName, resourceName, subsetPrefix = null) {
  const { compressed, rawLength } = createFakeFontFile();

  const fontFileDict = doc.context.obj({});
  fontFileDict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
  fontFileDict.set(PDFName.of('Length'), doc.context.obj(compressed.length));
  fontFileDict.set(PDFName.of('Length1'), doc.context.obj(rawLength));
  const fontFileStream = PDFRawStream.of(fontFileDict, compressed);
  const fontFileRef = doc.context.register(fontFileStream);

  const fullName = subsetPrefix ? `${subsetPrefix}+${fontName}` : fontName;

  const fontDescriptor = doc.context.obj({});
  fontDescriptor.set(PDFName.of('Type'), PDFName.of('FontDescriptor'));
  fontDescriptor.set(PDFName.of('FontName'), PDFName.of(fullName));
  fontDescriptor.set(PDFName.of('Flags'), doc.context.obj(32));
  fontDescriptor.set(PDFName.of('FontBBox'), doc.context.obj([-166, -225, 1000, 931]));
  fontDescriptor.set(PDFName.of('ItalicAngle'), doc.context.obj(0));
  fontDescriptor.set(PDFName.of('Ascent'), doc.context.obj(718));
  fontDescriptor.set(PDFName.of('Descent'), doc.context.obj(-207));
  fontDescriptor.set(PDFName.of('CapHeight'), doc.context.obj(718));
  fontDescriptor.set(PDFName.of('StemV'), doc.context.obj(88));
  fontDescriptor.set(PDFName.of('FontFile2'), fontFileRef);
  const fontDescRef = doc.context.register(fontDescriptor);

  const fontDict = doc.context.obj({});
  fontDict.set(PDFName.of('Type'), PDFName.of('Font'));
  fontDict.set(PDFName.of('Subtype'), PDFName.of('Type1'));
  fontDict.set(PDFName.of('BaseFont'), PDFName.of(fullName));
  fontDict.set(PDFName.of('Encoding'), PDFName.of('WinAnsiEncoding'));
  fontDict.set(PDFName.of('FontDescriptor'), fontDescRef);
  const fontRef = doc.context.register(fontDict);

  // Wire into page resources
  let resources = page.node.get(PDFName.of('Resources'));
  if (!resources || !(resources instanceof PDFDict)) {
    resources = doc.context.obj({});
    page.node.set(PDFName.of('Resources'), resources);
  }
  let fontsDict = resources.get(PDFName.of('Font'));
  if (!fontsDict || !(fontsDict instanceof PDFDict)) {
    fontsDict = doc.context.obj({});
    resources.set(PDFName.of('Font'), fontsDict);
  }
  fontsDict.set(PDFName.of(resourceName), fontRef);

  return fontRef;
}

/** Add a FlateDecode image XObject to a page. */
function addFlateImage(doc, page, width, height, colorSpace, resourceName) {
  const components = colorSpace === 'DeviceGray' ? 1 : 3;
  const pixels = generateSinePixels(width, height, components);
  const compressed = deflateSync(pixels, { level: 1 }); // level 1 = bloated

  const imgDict = doc.context.obj({});
  imgDict.set(PDFName.of('Type'), PDFName.of('XObject'));
  imgDict.set(PDFName.of('Subtype'), PDFName.of('Image'));
  imgDict.set(PDFName.of('Width'), doc.context.obj(width));
  imgDict.set(PDFName.of('Height'), doc.context.obj(height));
  imgDict.set(PDFName.of('ColorSpace'), PDFName.of(colorSpace));
  imgDict.set(PDFName.of('BitsPerComponent'), doc.context.obj(8));
  imgDict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
  imgDict.set(PDFName.of('Length'), doc.context.obj(compressed.length));
  const imgStream = PDFRawStream.of(imgDict, compressed);
  const imgRef = doc.context.register(imgStream);

  // Wire into page XObject resources
  let resources = page.node.get(PDFName.of('Resources'));
  if (!resources || !(resources instanceof PDFDict)) {
    resources = doc.context.obj({});
    page.node.set(PDFName.of('Resources'), resources);
  }
  let xobjects = resources.get(PDFName.of('XObject'));
  if (!xobjects || !(xobjects instanceof PDFDict)) {
    xobjects = doc.context.obj({});
    resources.set(PDFName.of('XObject'), xobjects);
  }
  xobjects.set(PDFName.of(resourceName), imgRef);

  return imgRef;
}

/** Add a DCTDecode (JPEG) image XObject to a page. */
function addJpegImage(doc, page, width, height, pageWidth, resourceName, quality = 95) {
  const rgbaData = generateSineRgba(width, height);
  const jpegData = new Uint8Array(
    jpegEncode({ data: rgbaData, width, height }, quality).data,
  );

  const imgDict = doc.context.obj({});
  imgDict.set(PDFName.of('Type'), PDFName.of('XObject'));
  imgDict.set(PDFName.of('Subtype'), PDFName.of('Image'));
  imgDict.set(PDFName.of('Width'), doc.context.obj(width));
  imgDict.set(PDFName.of('Height'), doc.context.obj(height));
  imgDict.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'));
  imgDict.set(PDFName.of('BitsPerComponent'), doc.context.obj(8));
  imgDict.set(PDFName.of('Filter'), PDFName.of('DCTDecode'));
  imgDict.set(PDFName.of('Length'), doc.context.obj(jpegData.length));
  const imgStream = PDFRawStream.of(imgDict, jpegData);
  const imgRef = doc.context.register(imgStream);

  let resources = page.node.get(PDFName.of('Resources'));
  if (!resources || !(resources instanceof PDFDict)) {
    resources = doc.context.obj({});
    page.node.set(PDFName.of('Resources'), resources);
  }
  let xobjects = resources.get(PDFName.of('XObject'));
  if (!xobjects || !(xobjects instanceof PDFDict)) {
    xobjects = doc.context.obj({});
    resources.set(PDFName.of('XObject'), xobjects);
  }
  xobjects.set(PDFName.of(resourceName), imgRef);

  return imgRef;
}

/** Add XMP metadata stream to the catalog. */
function addXmpMetadata(doc, xmpXml) {
  const xmpData = new TextEncoder().encode(xmpXml);
  const xmpDict = doc.context.obj({});
  xmpDict.set(PDFName.of('Type'), PDFName.of('Metadata'));
  xmpDict.set(PDFName.of('Subtype'), PDFName.of('XML'));
  xmpDict.set(PDFName.of('Length'), doc.context.obj(xmpData.length));
  const xmpStream = PDFRawStream.of(xmpDict, xmpData);
  const xmpRef = doc.context.register(xmpStream);
  doc.catalog.set(PDFName.of('Metadata'), xmpRef);
  return xmpRef;
}

/** Add bloat keys (PieceInfo, AIPrivateData, Thumb) to the page. */
function addBloatKeys(doc, page) {
  const pageDict = page.node;

  // PieceInfo
  const pieceInfo = doc.context.obj({});
  pieceInfo.set(PDFName.of('Illustrator'), doc.context.obj({}));
  pageDict.set(PDFName.of('PieceInfo'), pieceInfo);

  // AIPrivateData entries
  for (let i = 1; i <= 4; i++) {
    const data = new Uint8Array(500);
    data.fill(i);
    const dict = doc.context.obj({});
    dict.set(PDFName.of('Length'), doc.context.obj(data.length));
    const stream = PDFRawStream.of(dict, data);
    const ref = doc.context.register(stream);
    pageDict.set(PDFName.of(`AIPrivateData${i}`), ref);
  }

  // Thumbnail
  const thumbData = new Uint8Array(200);
  thumbData.fill(0x80);
  const thumbDict = doc.context.obj({});
  thumbDict.set(PDFName.of('Length'), doc.context.obj(thumbData.length));
  const thumbStream = PDFRawStream.of(thumbDict, thumbData);
  const thumbRef = doc.context.register(thumbStream);
  pageDict.set(PDFName.of('Thumb'), thumbRef);
}

/** Add orphan objects (not referenced from anywhere). */
function addOrphans(doc, count = 3) {
  for (let i = 0; i < count; i++) {
    const data = new Uint8Array(1000);
    data.fill(0xdd + i);
    const dict = doc.context.obj({});
    dict.set(PDFName.of('Length'), doc.context.obj(data.length));
    dict.set(PDFName.of('OrphanMarker'), PDFName.of('True'));
    const stream = PDFRawStream.of(dict, data);
    doc.context.register(stream);
  }
}

/** Add duplicate streams (identical content, separate objects). */
function addDuplicateStreams(doc, count = 4) {
  const data = new Uint8Array(800);
  for (let i = 0; i < data.length; i++) data[i] = 42;
  const compressed = deflateSync(data, { level: 6 });

  const refs = [];
  for (let i = 0; i < count; i++) {
    const dict = doc.context.obj({});
    dict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
    dict.set(PDFName.of('Length'), doc.context.obj(compressed.length));
    dict.set(PDFName.of('TestMarker'), PDFName.of('DuplicateStream'));
    const stream = PDFRawStream.of(dict, new Uint8Array(compressed));
    refs.push(doc.context.register(stream));
  }

  // Reference the first one from catalog so they're not all orphans
  doc.catalog.set(PDFName.of('DupTest'), refs[0]);
  return refs;
}

/** Add a level-1 compressed stream (bloated compression). */
function addPoorlyCompressedStreams(doc, count = 4) {
  for (let i = 0; i < count; i++) {
    const rawData = new Uint8Array(3000);
    for (let j = 0; j < rawData.length; j++) rawData[j] = (j + i) % 10 + 48;
    const compressed = deflateSync(rawData, { level: 1 });
    const dict = doc.context.obj({});
    dict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
    dict.set(PDFName.of('Length'), doc.context.obj(compressed.length));
    const stream = PDFRawStream.of(dict, compressed);
    const ref = doc.context.register(stream);
    // Reference from catalog so not orphaned
    doc.catalog.set(PDFName.of(`Stream${i}`), ref);
  }
}

/** Build a tagged structure tree on the catalog. Returns struct elem count. */
function addStructureTree(doc, page) {
  // Set /Lang
  doc.catalog.set(PDFName.of('Lang'), PDFString.of('en-US'));

  // Set /MarkInfo << /Marked true >>
  const markInfo = doc.context.obj({});
  markInfo.set(PDFName.of('Marked'), doc.context.obj(true));
  doc.catalog.set(PDFName.of('MarkInfo'), markInfo);

  // Build structure tree: Document > Section > (H1, P, Figure)
  const figureElem = doc.context.obj({});
  figureElem.set(PDFName.of('Type'), PDFName.of('StructElem'));
  figureElem.set(PDFName.of('S'), PDFName.of('Figure'));
  figureElem.set(PDFName.of('Alt'), PDFString.of('A sample figure'));
  const figureRef = doc.context.register(figureElem);

  const h1Elem = doc.context.obj({});
  h1Elem.set(PDFName.of('Type'), PDFName.of('StructElem'));
  h1Elem.set(PDFName.of('S'), PDFName.of('H1'));
  const h1Ref = doc.context.register(h1Elem);

  const pElem = doc.context.obj({});
  pElem.set(PDFName.of('Type'), PDFName.of('StructElem'));
  pElem.set(PDFName.of('S'), PDFName.of('P'));
  const pRef = doc.context.register(pElem);

  const sectionElem = doc.context.obj({});
  sectionElem.set(PDFName.of('Type'), PDFName.of('StructElem'));
  sectionElem.set(PDFName.of('S'), PDFName.of('Sect'));
  sectionElem.set(PDFName.of('K'), doc.context.obj([h1Ref, pRef, figureRef]));
  const sectionRef = doc.context.register(sectionElem);

  const docElem = doc.context.obj({});
  docElem.set(PDFName.of('Type'), PDFName.of('StructElem'));
  docElem.set(PDFName.of('S'), PDFName.of('Document'));
  docElem.set(PDFName.of('K'), doc.context.obj([sectionRef]));
  const docRef = doc.context.register(docElem);

  // Set parent pointers
  figureElem.set(PDFName.of('P'), sectionRef);
  h1Elem.set(PDFName.of('P'), sectionRef);
  pElem.set(PDFName.of('P'), sectionRef);
  sectionElem.set(PDFName.of('P'), docRef);

  const structTreeRoot = doc.context.obj({});
  structTreeRoot.set(PDFName.of('Type'), PDFName.of('StructTreeRoot'));
  structTreeRoot.set(PDFName.of('K'), doc.context.obj([docRef]));
  const structTreeRootRef = doc.context.register(structTreeRoot);

  docElem.set(PDFName.of('P'), structTreeRootRef);
  doc.catalog.set(PDFName.of('StructTreeRoot'), structTreeRootRef);

  return 5; // Document, Sect, H1, P, Figure
}

// --- Reference PDF Generators ---

/**
 * Simulates Illustrator "Save As PDF" bloat.
 * 2 embedded standard fonts (~50KB each), XMP, PieceInfo, AIPrivateData (4 entries),
 * Thumb per page, 3 orphans, 4 duplicate streams, level-1 compression.
 */
export async function createIllustratorStylePdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]); // US Letter

  // 2 embedded standard fonts
  addEmbeddedStandardFont(doc, page, 'Helvetica', 'F1');
  addEmbeddedStandardFont(doc, page, 'Courier', 'F2');

  // XMP metadata (~5KB)
  addXmpMetadata(doc,
    '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>' +
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">' +
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
    '<rdf:Description rdf:about=""' +
    ' xmlns:xmp="http://ns.adobe.com/xap/1.0/"' +
    ' xmlns:dc="http://purl.org/dc/elements/1.1/"' +
    ' xmlns:pdf="http://ns.adobe.com/pdf/1.3/">' +
    '<xmp:CreatorTool>Adobe Illustrator 27.0</xmp:CreatorTool>' +
    '<xmp:CreateDate>2024-01-15T10:30:00Z</xmp:CreateDate>' +
    '<dc:format>application/pdf</dc:format>' +
    '<dc:title><rdf:Alt><rdf:li xml:lang="x-default">Test Document</rdf:li></rdf:Alt></dc:title>' +
    '<pdf:Producer>Adobe PDF library 17.0</pdf:Producer>' +
    '</rdf:Description>' +
    '</rdf:RDF></x:xmpmeta>' +
    ' '.repeat(3000) + // Padding (common in real XMP)
    '<?xpacket end="w"?>',
  );

  // PieceInfo + AIPrivateData + Thumb
  addBloatKeys(doc, page);

  // Orphan objects
  addOrphans(doc, 3);

  // Duplicate streams
  addDuplicateStreams(doc, 4);

  // Poorly compressed streams
  addPoorlyCompressedStreams(doc, 4);

  return new Uint8Array(await doc.save({ useObjectStreams: false }));
}

/**
 * Simulates an image-rich report.
 * 3 FlateDecode images (various sizes/colorspaces) + 1 high-DPI DCT JPEG,
 * level-1 compression throughout.
 */
export async function createPhotoHeavyPdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);

  // 3 FlateDecode images with level-1 compression
  addFlateImage(doc, page, 200, 200, 'DeviceRGB', 'Img0');
  addFlateImage(doc, page, 300, 300, 'DeviceRGB', 'Img1');
  addFlateImage(doc, page, 150, 150, 'DeviceGray', 'Img2');

  // 1 high-DPI JPEG (400x400 on a 100pt area — ~288 DPI)
  // For DPI calc: image needs to be on a page where the ratio gives high DPI
  const page2 = doc.addPage([100, 100]);
  addJpegImage(doc, page2, 400, 400, 100, 'Img3', 95);

  // Some poorly compressed streams for stream pass
  addPoorlyCompressedStreams(doc, 2);

  return new Uint8Array(await doc.save({ useObjectStreams: false }));
}

/**
 * Simulates an accessible document with tagged structure.
 * StructTreeRoot hierarchy, MarkInfo, /Lang, /Alt on Figure, ToUnicode CMap,
 * 1 embedded standard font, 1 orphan, 1 uncompressed stream.
 */
export async function createTaggedAccessiblePdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);

  // Tagged structure tree
  addStructureTree(doc, page);

  // 1 embedded standard font with ToUnicode
  addEmbeddedStandardFont(doc, page, 'Helvetica', 'F1');

  // Add a ToUnicode CMap to the font
  const cmapText =
    '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n' +
    '/CMapType 2 def\n1 begincodespacerange\n<00> <FF>\nendcodespacerange\n' +
    '1 beginbfchar\n<48> <0048>\nendbfchar\nendcmap\n' +
    'CMapName currentdict /CMap defineresource pop\nend\nend';
  const cmapBytes = new TextEncoder().encode(cmapText);
  const cmapDict = doc.context.obj({});
  cmapDict.set(PDFName.of('Length'), doc.context.obj(cmapBytes.length));
  const cmapStream = PDFRawStream.of(cmapDict, cmapBytes);
  const cmapRef = doc.context.register(cmapStream);

  // Find the font and add ToUnicode
  const resources = page.node.get(PDFName.of('Resources'));
  const fontsDict = resources.get(PDFName.of('Font'));
  const fontRef = fontsDict.get(PDFName.of('F1'));
  const fontDict = doc.context.lookup(fontRef);
  fontDict.set(PDFName.of('ToUnicode'), cmapRef);

  // 1 orphan
  addOrphans(doc, 1);

  // 1 uncompressed stream
  const rawData = new Uint8Array(2000);
  for (let i = 0; i < rawData.length; i++) rawData[i] = i % 26 + 65;
  const dict = doc.context.obj({});
  dict.set(PDFName.of('Length'), doc.context.obj(rawData.length));
  const stream = PDFRawStream.of(dict, rawData);
  const ref = doc.context.register(stream);
  doc.catalog.set(PDFName.of('ExtraStream'), ref);

  return new Uint8Array(await doc.save({ useObjectStreams: false }));
}

/**
 * Simulates a PDF/A-1b archival document.
 * XMP with pdfaid:part=1,conformance=B, dc:language=fr, OutputIntents,
 * embedded Helvetica (must NOT be unembedded), PieceInfo,
 * 3 uncompressed streams, 2 duplicates, 1 orphan.
 */
export async function createPdfA1bDocument() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);

  doc.setTitle('PDF/A-1b Test Document');

  // XMP with PDF/A-1b conformance + dc:language
  addXmpMetadata(doc,
    '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>' +
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">' +
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"' +
    ' xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"' +
    ' xmlns:dc="http://purl.org/dc/elements/1.1/">' +
    '<rdf:Description rdf:about="">' +
    '<pdfaid:part>1</pdfaid:part>' +
    '<pdfaid:conformance>B</pdfaid:conformance>' +
    '<dc:language><rdf:Bag><rdf:li xml:lang="x-default">fr</rdf:li></rdf:Bag></dc:language>' +
    '</rdf:Description>' +
    '</rdf:RDF></x:xmpmeta><?xpacket end="w"?>',
  );

  // OutputIntents (required by PDF/A)
  const outputIntentDict = doc.context.obj({});
  outputIntentDict.set(PDFName.of('Type'), PDFName.of('OutputIntent'));
  outputIntentDict.set(PDFName.of('S'), PDFName.of('GTS_PDFA1'));
  outputIntentDict.set(PDFName.of('OutputConditionIdentifier'), PDFString.of('sRGB'));
  outputIntentDict.set(PDFName.of('RegistryName'), PDFString.of('http://www.color.org'));
  const outputIntentRef = doc.context.register(outputIntentDict);
  doc.catalog.set(PDFName.of('OutputIntents'), doc.context.obj([outputIntentRef]));

  // Embedded Helvetica (must survive — PDF/A requires all fonts embedded)
  addEmbeddedStandardFont(doc, page, 'Helvetica', 'F1');

  // PieceInfo (still strippable even for PDF/A)
  const pieceInfo = doc.context.obj({});
  pieceInfo.set(PDFName.of('Illustrator'), doc.context.obj({}));
  page.node.set(PDFName.of('PieceInfo'), pieceInfo);

  // 3 uncompressed streams
  for (let i = 0; i < 3; i++) {
    const rawData = new Uint8Array(2000);
    for (let j = 0; j < rawData.length; j++) rawData[j] = (j + i * 7) % 26 + 65;
    const dict = doc.context.obj({});
    dict.set(PDFName.of('Length'), doc.context.obj(rawData.length));
    const stream = PDFRawStream.of(dict, rawData);
    const ref = doc.context.register(stream);
    doc.catalog.set(PDFName.of(`Extra${i}`), ref);
  }

  // 2 duplicate streams
  addDuplicateStreams(doc, 2);

  // 1 orphan
  addOrphans(doc, 1);

  return new Uint8Array(await doc.save({ useObjectStreams: false }));
}

/**
 * Simulates multi-tool font mess with duplicate font instances.
 * 3x Helvetica (different subset prefixes), 2x Courier, 1x Times-Roman
 * (all standard with FontFile2), 1x MyCustomFont-Regular (non-standard, must survive).
 * Plus XMP and some level-1 streams.
 */
export async function createMultiFontDuplicatesPdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);

  // 3x Helvetica with different subset prefixes
  addEmbeddedStandardFont(doc, page, 'Helvetica', 'F1', 'ABCDEF');
  addEmbeddedStandardFont(doc, page, 'Helvetica', 'F2', 'GHIJKL');
  addEmbeddedStandardFont(doc, page, 'Helvetica', 'F3', 'MNOPQR');

  // 2x Courier
  addEmbeddedStandardFont(doc, page, 'Courier', 'F4', 'STUVWX');
  addEmbeddedStandardFont(doc, page, 'Courier', 'F5', 'YZABCD');

  // 1x Times-Roman
  addEmbeddedStandardFont(doc, page, 'Times-Roman', 'F6');

  // 1x Non-standard font (must survive unembedding)
  const { compressed: customCompressed, rawLength: customRawLen } = createFakeFontFile(20000);
  const customFfDict = doc.context.obj({});
  customFfDict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
  customFfDict.set(PDFName.of('Length'), doc.context.obj(customCompressed.length));
  customFfDict.set(PDFName.of('Length1'), doc.context.obj(customRawLen));
  const customFfStream = PDFRawStream.of(customFfDict, customCompressed);
  const customFfRef = doc.context.register(customFfStream);

  const customDescriptor = doc.context.obj({});
  customDescriptor.set(PDFName.of('Type'), PDFName.of('FontDescriptor'));
  customDescriptor.set(PDFName.of('FontName'), PDFName.of('MyCustomFont-Regular'));
  customDescriptor.set(PDFName.of('Flags'), doc.context.obj(32));
  customDescriptor.set(PDFName.of('FontFile2'), customFfRef);
  const customDescRef = doc.context.register(customDescriptor);

  const customFontDict = doc.context.obj({});
  customFontDict.set(PDFName.of('Type'), PDFName.of('Font'));
  customFontDict.set(PDFName.of('Subtype'), PDFName.of('TrueType'));
  customFontDict.set(PDFName.of('BaseFont'), PDFName.of('MyCustomFont-Regular'));
  customFontDict.set(PDFName.of('FontDescriptor'), customDescRef);
  const customFontRef = doc.context.register(customFontDict);

  const resources = page.node.get(PDFName.of('Resources'));
  const fontsDict = resources.get(PDFName.of('Font'));
  fontsDict.set(PDFName.of('F7'), customFontRef);

  // XMP metadata
  addXmpMetadata(doc,
    '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>' +
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">' +
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
    '</rdf:RDF></x:xmpmeta><?xpacket end="w"?>',
  );

  // Some level-1 streams
  addPoorlyCompressedStreams(doc, 3);

  return new Uint8Array(await doc.save({ useObjectStreams: false }));
}

/**
 * Kitchen sink: everything combined. NOT PDF/A, so all passes fire.
 * 4 pages: text+fonts+image, high-DPI JPEG, tagged content, duplicate font refs.
 * Plus XMP, PieceInfo, AIPrivateData, Thumb, 4 duplicates, 3 orphans, level-1 throughout.
 */
export async function createKitchenSinkPdf() {
  const doc = await PDFDocument.create();

  // --- Page 1: Text + fonts + image ---
  const page1 = doc.addPage([612, 792]);
  addEmbeddedStandardFont(doc, page1, 'Helvetica', 'F1', 'AAAAAA');
  addEmbeddedStandardFont(doc, page1, 'Courier', 'F2');
  addFlateImage(doc, page1, 200, 200, 'DeviceRGB', 'Img0');

  // --- Page 2: High-DPI JPEG ---
  const page2 = doc.addPage([100, 100]);
  addJpegImage(doc, page2, 400, 400, 100, 'Img1', 95);

  // --- Page 3: Tagged content ---
  const page3 = doc.addPage([612, 792]);
  addStructureTree(doc, page3);

  // --- Page 4: Duplicate font refs ---
  const page4 = doc.addPage([612, 792]);
  addEmbeddedStandardFont(doc, page4, 'Helvetica', 'F1', 'BBBBBB');
  addEmbeddedStandardFont(doc, page4, 'Times-Roman', 'F2');

  // XMP metadata
  addXmpMetadata(doc,
    '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>' +
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">' +
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"' +
    ' xmlns:xmp="http://ns.adobe.com/xap/1.0/">' +
    '<rdf:Description rdf:about="">' +
    '<xmp:CreatorTool>Kitchen Sink Generator</xmp:CreatorTool>' +
    '</rdf:Description>' +
    '</rdf:RDF></x:xmpmeta>' +
    ' '.repeat(2000) +
    '<?xpacket end="w"?>',
  );

  // Bloat keys on pages 1 and 4
  addBloatKeys(doc, page1);
  addBloatKeys(doc, page4);

  // Duplicate streams
  addDuplicateStreams(doc, 4);

  // Orphans
  addOrphans(doc, 3);

  // Level-1 streams
  addPoorlyCompressedStreams(doc, 4);

  return new Uint8Array(await doc.save({ useObjectStreams: false }));
}

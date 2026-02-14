/**
 * Programmatically generate test PDFs with specific characteristics
 * for each optimization pass.
 */
import {
  PDFDocument,
  PDFName,
  PDFDict,
  PDFArray,
  PDFString,
  PDFHexString,
  PDFRawStream,
  PDFRef,
  StandardFonts,
  rgb,
} from 'pdf-lib';
import { deflateSync } from 'fflate';
import { encode as jpegEncode } from 'jpeg-js';

/**
 * Create a simple valid PDF with one page and some text.
 */
export async function createSimplePdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Hello World', { x: 10, y: 100, size: 12, font });
  return doc;
}

/**
 * Create a PDF with a stream that uses suboptimal (no) compression.
 * Injects an uncompressed stream that could benefit from Flate recompression.
 */
export async function createUncompressedStreamPdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Test', { x: 10, y: 100, size: 12, font });

  // Add a large uncompressed stream object
  const bigData = new Uint8Array(2000);
  // Fill with repetitive data that compresses well
  for (let i = 0; i < bigData.length; i++) {
    bigData[i] = i % 26 + 65; // A-Z repeating
  }

  const dict = doc.context.obj({});
  dict.set(PDFName.of('Length'), doc.context.obj(bigData.length));
  const stream = PDFRawStream.of(dict, bigData);
  doc.context.register(stream);

  return doc;
}

/**
 * Create a PDF with poorly compressed streams (level 1 deflate).
 */
export async function createPoorlyCompressedPdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Compressed Test', { x: 10, y: 100, size: 12, font });

  // Create a stream with level 1 compression
  const rawData = new Uint8Array(3000);
  for (let i = 0; i < rawData.length; i++) {
    rawData[i] = i % 10 + 48; // 0-9 repeating
  }

  const compressed = deflateSync(rawData, { level: 1 });
  const dict = doc.context.obj({});
  dict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
  dict.set(PDFName.of('Length'), doc.context.obj(compressed.length));
  const stream = PDFRawStream.of(dict, compressed);
  doc.context.register(stream);

  return doc;
}

/**
 * Create a PDF with duplicate stream objects.
 */
export async function createDuplicateObjectsPdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Dedup Test', { x: 10, y: 100, size: 12, font });

  // Add two identical streams
  const data = new Uint8Array(500);
  for (let i = 0; i < data.length; i++) data[i] = 42;

  const compressed = deflateSync(data, { level: 6 });

  for (let i = 0; i < 3; i++) {
    const dict = doc.context.obj({});
    dict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
    dict.set(PDFName.of('Length'), doc.context.obj(compressed.length));
    dict.set(PDFName.of('TestMarker'), PDFName.of('DuplicateStream'));
    const stream = PDFRawStream.of(dict, new Uint8Array(compressed));
    doc.context.register(stream);
  }

  return doc;
}

/**
 * Create a PDF with XMP metadata and bloat keys.
 */
export async function createMetadataBloatPdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Metadata Test', { x: 10, y: 100, size: 12, font });

  // Set document metadata (this goes in /Info)
  doc.setTitle('Test Document');
  doc.setAuthor('Test Author');

  // Add XMP metadata stream to catalog
  const xmpData = new TextEncoder().encode(
    '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>' +
      '<x:xmpmeta xmlns:x="adobe:ns:meta/">' +
      '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
      '</rdf:RDF></x:xmpmeta><?xpacket end="w"?>',
  );
  const xmpDict = doc.context.obj({});
  xmpDict.set(PDFName.of('Type'), PDFName.of('Metadata'));
  xmpDict.set(PDFName.of('Subtype'), PDFName.of('XML'));
  xmpDict.set(PDFName.of('Length'), doc.context.obj(xmpData.length));
  const xmpStream = PDFRawStream.of(xmpDict, xmpData);
  const xmpRef = doc.context.register(xmpStream);
  doc.catalog.set(PDFName.of('Metadata'), xmpRef);

  // Add PieceInfo to the page
  const pageDict = page.node;
  const pieceInfo = doc.context.obj({});
  pieceInfo.set(PDFName.of('Illustrator'), doc.context.obj({}));
  pageDict.set(PDFName.of('PieceInfo'), pieceInfo);

  return doc;
}

/**
 * Create a PDF with an unreferenced object (orphan).
 */
export async function createUnreferencedObjectPdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Unreferenced Test', { x: 10, y: 100, size: 12, font });

  // Register objects that are NOT referenced from any page or catalog entry
  const orphanData = new Uint8Array(1000);
  for (let i = 0; i < orphanData.length; i++) orphanData[i] = 0xff;
  const orphanDict = doc.context.obj({});
  orphanDict.set(PDFName.of('Length'), doc.context.obj(orphanData.length));
  orphanDict.set(PDFName.of('OrphanMarker'), PDFName.of('True'));
  const orphanStream = PDFRawStream.of(orphanDict, orphanData);
  doc.context.register(orphanStream);

  // Another orphan
  const orphanDict2 = doc.context.obj({ Type: 'Orphan', Value: 'Unused' });
  doc.context.register(orphanDict2);

  return doc;
}

// --- Image test fixtures ---

/**
 * Create a PDF with a FlateDecode RGB image (100x100 gradient).
 * Large enough to exceed the 10KB minimum for image recompression.
 */
export async function createPdfWithFlatDecodeRgbImage() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);

  const width = 100;
  const height = 100;
  const components = 3;
  const pixels = new Uint8Array(width * height * components);

  // Create photo-like data: smooth gradients with mild variation.
  // Deflate can't compress this well (no exact byte repeats),
  // but JPEG handles smooth color transitions efficiently.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * components;
      const xf = x / width;
      const yf = y / height;
      // Overlapping sine waves create non-repeating but smooth data
      pixels[idx]     = Math.round(127 + 127 * Math.sin(xf * 7.3 + yf * 2.1));
      pixels[idx + 1] = Math.round(127 + 127 * Math.sin(yf * 5.7 + xf * 3.9));
      pixels[idx + 2] = Math.round(127 + 127 * Math.sin((xf + yf) * 4.1));
    }
  }

  const compressed = deflateSync(pixels, { level: 6 });

  const imgDict = doc.context.obj({});
  imgDict.set(PDFName.of('Type'), PDFName.of('XObject'));
  imgDict.set(PDFName.of('Subtype'), PDFName.of('Image'));
  imgDict.set(PDFName.of('Width'), doc.context.obj(width));
  imgDict.set(PDFName.of('Height'), doc.context.obj(height));
  imgDict.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'));
  imgDict.set(PDFName.of('BitsPerComponent'), doc.context.obj(8));
  imgDict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
  imgDict.set(PDFName.of('Length'), doc.context.obj(compressed.length));

  const imgStream = PDFRawStream.of(imgDict, compressed);
  const imgRef = doc.context.register(imgStream);

  // Reference the image from the page so it's not orphaned
  const xobjectDict = doc.context.obj({});
  xobjectDict.set(PDFName.of('Img0'), imgRef);
  page.node.set(PDFName.of('Resources'), doc.context.obj({}));
  page.node.get(PDFName.of('Resources')).set(PDFName.of('XObject'), xobjectDict);

  return doc;
}

/**
 * Create a PDF with a FlateDecode grayscale image.
 */
export async function createPdfWithFlatDecodeGrayImage() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);

  const width = 120;
  const height = 120;
  const pixels = new Uint8Array(width * height);

  // Smooth sine-wave pattern: deflate-inefficient but JPEG-friendly
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const xf = x / width;
      const yf = y / height;
      pixels[y * width + x] = Math.round(127 + 127 * Math.sin(xf * 7.3 + yf * 5.1));
    }
  }

  const compressed = deflateSync(pixels, { level: 6 });

  const imgDict = doc.context.obj({});
  imgDict.set(PDFName.of('Type'), PDFName.of('XObject'));
  imgDict.set(PDFName.of('Subtype'), PDFName.of('Image'));
  imgDict.set(PDFName.of('Width'), doc.context.obj(width));
  imgDict.set(PDFName.of('Height'), doc.context.obj(height));
  imgDict.set(PDFName.of('ColorSpace'), PDFName.of('DeviceGray'));
  imgDict.set(PDFName.of('BitsPerComponent'), doc.context.obj(8));
  imgDict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
  imgDict.set(PDFName.of('Length'), doc.context.obj(compressed.length));

  const imgStream = PDFRawStream.of(imgDict, compressed);
  const imgRef = doc.context.register(imgStream);

  const xobjectDict = doc.context.obj({});
  xobjectDict.set(PDFName.of('Img0'), imgRef);
  page.node.set(PDFName.of('Resources'), doc.context.obj({}));
  page.node.get(PDFName.of('Resources')).set(PDFName.of('XObject'), xobjectDict);

  return doc;
}

/**
 * Create a PDF with a DCTDecode (JPEG) image — should be skipped.
 */
export async function createPdfWithJpegImage() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);

  const width = 10;
  const height = 10;
  const rgbaData = new Uint8Array(width * height * 4);
  for (let i = 0; i < rgbaData.length; i += 4) {
    rgbaData[i] = 128;
    rgbaData[i + 1] = 128;
    rgbaData[i + 2] = 128;
    rgbaData[i + 3] = 255;
  }
  const jpegData = new Uint8Array(
    jpegEncode({ data: rgbaData, width, height }, 80).data,
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

  const xobjectDict = doc.context.obj({});
  xobjectDict.set(PDFName.of('Img0'), imgRef);
  page.node.set(PDFName.of('Resources'), doc.context.obj({}));
  page.node.get(PDFName.of('Resources')).set(PDFName.of('XObject'), xobjectDict);

  return doc;
}

/**
 * Create a PDF with a FlateDecode image that has an SMask (alpha) — should be skipped.
 */
export async function createPdfWithAlphaImage() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);

  const width = 50;
  const height = 50;
  const pixels = new Uint8Array(width * height * 3);
  pixels.fill(128);
  const compressed = deflateSync(pixels, { level: 6 });

  // Create the SMask stream
  const maskPixels = new Uint8Array(width * height);
  maskPixels.fill(200);
  const maskCompressed = deflateSync(maskPixels, { level: 6 });

  const maskDict = doc.context.obj({});
  maskDict.set(PDFName.of('Type'), PDFName.of('XObject'));
  maskDict.set(PDFName.of('Subtype'), PDFName.of('Image'));
  maskDict.set(PDFName.of('Width'), doc.context.obj(width));
  maskDict.set(PDFName.of('Height'), doc.context.obj(height));
  maskDict.set(PDFName.of('ColorSpace'), PDFName.of('DeviceGray'));
  maskDict.set(PDFName.of('BitsPerComponent'), doc.context.obj(8));
  maskDict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
  maskDict.set(PDFName.of('Length'), doc.context.obj(maskCompressed.length));
  const maskStream = PDFRawStream.of(maskDict, maskCompressed);
  const maskRef = doc.context.register(maskStream);

  // Main image with SMask
  const imgDict = doc.context.obj({});
  imgDict.set(PDFName.of('Type'), PDFName.of('XObject'));
  imgDict.set(PDFName.of('Subtype'), PDFName.of('Image'));
  imgDict.set(PDFName.of('Width'), doc.context.obj(width));
  imgDict.set(PDFName.of('Height'), doc.context.obj(height));
  imgDict.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'));
  imgDict.set(PDFName.of('BitsPerComponent'), doc.context.obj(8));
  imgDict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
  imgDict.set(PDFName.of('Length'), doc.context.obj(compressed.length));
  imgDict.set(PDFName.of('SMask'), maskRef);

  const imgStream = PDFRawStream.of(imgDict, compressed);
  const imgRef = doc.context.register(imgStream);

  const xobjectDict = doc.context.obj({});
  xobjectDict.set(PDFName.of('Img0'), imgRef);
  page.node.set(PDFName.of('Resources'), doc.context.obj({}));
  page.node.get(PDFName.of('Resources')).set(PDFName.of('XObject'), xobjectDict);

  return doc;
}

// --- Font unembedding test fixtures ---

/**
 * Create a PDF with an embedded standard font (Type1 Helvetica with FontDescriptor + FontFile2).
 * Manually constructs the font structures to simulate what Illustrator/InDesign does.
 */
export async function createPdfWithEmbeddedStandardFont() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);

  // Create a fake FontFile2 (TrueType font program) — just needs to be some bytes
  const fontFileData = new Uint8Array(5000);
  for (let i = 0; i < fontFileData.length; i++) fontFileData[i] = i % 256;
  const fontFileCompressed = deflateSync(fontFileData, { level: 6 });

  const fontFileDict = doc.context.obj({});
  fontFileDict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
  fontFileDict.set(PDFName.of('Length'), doc.context.obj(fontFileCompressed.length));
  fontFileDict.set(PDFName.of('Length1'), doc.context.obj(fontFileData.length));
  const fontFileStream = PDFRawStream.of(fontFileDict, fontFileCompressed);
  const fontFileRef = doc.context.register(fontFileStream);

  // Create FontDescriptor
  const fontDescriptor = doc.context.obj({});
  fontDescriptor.set(PDFName.of('Type'), PDFName.of('FontDescriptor'));
  fontDescriptor.set(PDFName.of('FontName'), PDFName.of('Helvetica'));
  fontDescriptor.set(PDFName.of('Flags'), doc.context.obj(32));
  fontDescriptor.set(PDFName.of('FontBBox'), doc.context.obj([-166, -225, 1000, 931]));
  fontDescriptor.set(PDFName.of('ItalicAngle'), doc.context.obj(0));
  fontDescriptor.set(PDFName.of('Ascent'), doc.context.obj(718));
  fontDescriptor.set(PDFName.of('Descent'), doc.context.obj(-207));
  fontDescriptor.set(PDFName.of('CapHeight'), doc.context.obj(718));
  fontDescriptor.set(PDFName.of('StemV'), doc.context.obj(88));
  fontDescriptor.set(PDFName.of('FontFile2'), fontFileRef);
  const fontDescRef = doc.context.register(fontDescriptor);

  // Create Font dict
  const fontDict = doc.context.obj({});
  fontDict.set(PDFName.of('Type'), PDFName.of('Font'));
  fontDict.set(PDFName.of('Subtype'), PDFName.of('Type1'));
  fontDict.set(PDFName.of('BaseFont'), PDFName.of('Helvetica'));
  fontDict.set(PDFName.of('Encoding'), PDFName.of('WinAnsiEncoding'));
  fontDict.set(PDFName.of('FontDescriptor'), fontDescRef);
  const fontRef = doc.context.register(fontDict);

  // Wire font into the page's Resources
  const resources = doc.context.obj({});
  const fontsDict = doc.context.obj({});
  fontsDict.set(PDFName.of('F1'), fontRef);
  resources.set(PDFName.of('Font'), fontsDict);
  page.node.set(PDFName.of('Resources'), resources);

  return doc;
}

/**
 * Create a PDF with a subset-prefixed embedded standard font (ABCDEF+Helvetica).
 */
export async function createPdfWithSubsetPrefixedFont() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);

  const fontFileData = new Uint8Array(3000);
  fontFileData.fill(0xaa);
  const fontFileCompressed = deflateSync(fontFileData, { level: 6 });

  const fontFileDict = doc.context.obj({});
  fontFileDict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
  fontFileDict.set(PDFName.of('Length'), doc.context.obj(fontFileCompressed.length));
  const fontFileStream = PDFRawStream.of(fontFileDict, fontFileCompressed);
  const fontFileRef = doc.context.register(fontFileStream);

  const fontDescriptor = doc.context.obj({});
  fontDescriptor.set(PDFName.of('Type'), PDFName.of('FontDescriptor'));
  fontDescriptor.set(PDFName.of('FontName'), PDFName.of('ABCDEF+Helvetica'));
  fontDescriptor.set(PDFName.of('FontFile2'), fontFileRef);
  const fontDescRef = doc.context.register(fontDescriptor);

  const fontDict = doc.context.obj({});
  fontDict.set(PDFName.of('Type'), PDFName.of('Font'));
  fontDict.set(PDFName.of('Subtype'), PDFName.of('TrueType'));
  fontDict.set(PDFName.of('BaseFont'), PDFName.of('ABCDEF+Helvetica'));
  fontDict.set(PDFName.of('FontDescriptor'), fontDescRef);
  const fontRef = doc.context.register(fontDict);

  const resources = doc.context.obj({});
  const fontsDict = doc.context.obj({});
  fontsDict.set(PDFName.of('F1'), fontRef);
  resources.set(PDFName.of('Font'), fontsDict);
  page.node.set(PDFName.of('Resources'), resources);

  return doc;
}

/**
 * Create a PDF with a Type0 composite standard font — should be skipped.
 */
export async function createPdfWithType0StandardFont() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);

  // Use pdf-lib's embedFont which creates a Type0 composite
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Type0 test', { x: 10, y: 100, size: 12, font });

  return doc;
}

/**
 * Create a PDF with a high-DPI image (400x400px on a 100x100pt page = ~288 DPI).
 * Used to test downsampling behavior.
 */
export async function createPdfWithHighDpiImage() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([100, 100]);

  const width = 400;
  const height = 400;
  const components = 3;
  const pixels = new Uint8Array(width * height * components);

  // Smooth sine-wave pattern (photo-like, per project conventions)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * components;
      const xf = x / width;
      const yf = y / height;
      pixels[idx]     = Math.round(127 + 127 * Math.sin(xf * 7.3 + yf * 2.1));
      pixels[idx + 1] = Math.round(127 + 127 * Math.sin(yf * 5.7 + xf * 3.9));
      pixels[idx + 2] = Math.round(127 + 127 * Math.sin((xf + yf) * 4.1));
    }
  }

  const compressed = deflateSync(pixels, { level: 6 });

  const imgDict = doc.context.obj({});
  imgDict.set(PDFName.of('Type'), PDFName.of('XObject'));
  imgDict.set(PDFName.of('Subtype'), PDFName.of('Image'));
  imgDict.set(PDFName.of('Width'), doc.context.obj(width));
  imgDict.set(PDFName.of('Height'), doc.context.obj(height));
  imgDict.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'));
  imgDict.set(PDFName.of('BitsPerComponent'), doc.context.obj(8));
  imgDict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
  imgDict.set(PDFName.of('Length'), doc.context.obj(compressed.length));

  const imgStream = PDFRawStream.of(imgDict, compressed);
  const imgRef = doc.context.register(imgStream);

  const xobjectDict = doc.context.obj({});
  xobjectDict.set(PDFName.of('Img0'), imgRef);
  page.node.set(PDFName.of('Resources'), doc.context.obj({}));
  page.node.get(PDFName.of('Resources')).set(PDFName.of('XObject'), xobjectDict);

  return doc;
}

/**
 * Create a PDF with a non-standard font name — should be skipped.
 */
/**
 * Create a PDF with an embedded font using pdf-lib's embedFont (Type0/Identity-H).
 * Uses drawText() with known characters so we can test the full subsetting pipeline.
 * pdf-lib creates a Type0 font with a CIDFont descendant, Identity-H encoding,
 * and a ToUnicode CMap — ideal for testing font subsetting.
 */
export async function createPdfWithEmbeddedFont() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  // Use a small set of known characters
  page.drawText('Hello', { x: 10, y: 100, size: 12, font });
  return doc;
}

/**
 * Create a PDF with manual content stream text operators for parser unit tests.
 * Builds the content stream, Resources, and font references by hand.
 */
export async function createPdfWithContentStreamText() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);

  // Create a fake font file (needs to be >10KB for subsetting)
  const fontFileData = new Uint8Array(15000);
  for (let i = 0; i < fontFileData.length; i++) fontFileData[i] = i % 256;
  const fontFileCompressed = deflateSync(fontFileData, { level: 6 });

  const fontFileDict = doc.context.obj({});
  fontFileDict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
  fontFileDict.set(PDFName.of('Length'), doc.context.obj(fontFileCompressed.length));
  fontFileDict.set(PDFName.of('Length1'), doc.context.obj(fontFileData.length));
  const fontFileStream = PDFRawStream.of(fontFileDict, fontFileCompressed);
  const fontFileRef = doc.context.register(fontFileStream);

  // Create FontDescriptor
  const fontDescriptor = doc.context.obj({});
  fontDescriptor.set(PDFName.of('Type'), PDFName.of('FontDescriptor'));
  fontDescriptor.set(PDFName.of('FontName'), PDFName.of('TestFont'));
  fontDescriptor.set(PDFName.of('Flags'), doc.context.obj(32));
  fontDescriptor.set(PDFName.of('FontBBox'), doc.context.obj([-166, -225, 1000, 931]));
  fontDescriptor.set(PDFName.of('ItalicAngle'), doc.context.obj(0));
  fontDescriptor.set(PDFName.of('Ascent'), doc.context.obj(718));
  fontDescriptor.set(PDFName.of('Descent'), doc.context.obj(-207));
  fontDescriptor.set(PDFName.of('FontFile2'), fontFileRef);
  const fontDescRef = doc.context.register(fontDescriptor);

  // Create Font dict (simple TrueType with WinAnsiEncoding)
  const fontDict = doc.context.obj({});
  fontDict.set(PDFName.of('Type'), PDFName.of('Font'));
  fontDict.set(PDFName.of('Subtype'), PDFName.of('TrueType'));
  fontDict.set(PDFName.of('BaseFont'), PDFName.of('TestFont'));
  fontDict.set(PDFName.of('Encoding'), PDFName.of('WinAnsiEncoding'));
  fontDict.set(PDFName.of('FontDescriptor'), fontDescRef);
  const fontRef = doc.context.register(fontDict);

  // Create a content stream with text operators
  const contentText = 'BT /F1 12 Tf (Hello) Tj ET';
  const contentBytes = new TextEncoder().encode(contentText);
  const contentDict = doc.context.obj({});
  contentDict.set(PDFName.of('Length'), doc.context.obj(contentBytes.length));
  const contentStream = PDFRawStream.of(contentDict, contentBytes);
  const contentRef = doc.context.register(contentStream);

  // Wire up Resources and Contents on the page
  const resources = doc.context.obj({});
  const fontsDict = doc.context.obj({});
  fontsDict.set(PDFName.of('F1'), fontRef);
  resources.set(PDFName.of('Font'), fontsDict);
  page.node.set(PDFName.of('Resources'), resources);
  page.node.set(PDFName.of('Contents'), contentRef);

  return doc;
}

export async function createPdfWithNonStandardFont() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);

  const fontFileData = new Uint8Array(2000);
  fontFileData.fill(0xbb);
  const fontFileCompressed = deflateSync(fontFileData, { level: 6 });

  const fontFileDict = doc.context.obj({});
  fontFileDict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
  fontFileDict.set(PDFName.of('Length'), doc.context.obj(fontFileCompressed.length));
  const fontFileStream = PDFRawStream.of(fontFileDict, fontFileCompressed);
  const fontFileRef = doc.context.register(fontFileStream);

  const fontDescriptor = doc.context.obj({});
  fontDescriptor.set(PDFName.of('Type'), PDFName.of('FontDescriptor'));
  fontDescriptor.set(PDFName.of('FontName'), PDFName.of('MyCustomFont-Regular'));
  fontDescriptor.set(PDFName.of('FontFile2'), fontFileRef);
  const fontDescRef = doc.context.register(fontDescriptor);

  const fontDict = doc.context.obj({});
  fontDict.set(PDFName.of('Type'), PDFName.of('Font'));
  fontDict.set(PDFName.of('Subtype'), PDFName.of('TrueType'));
  fontDict.set(PDFName.of('BaseFont'), PDFName.of('MyCustomFont-Regular'));
  fontDict.set(PDFName.of('FontDescriptor'), fontDescRef);
  const fontRef = doc.context.register(fontDict);

  const resources = doc.context.obj({});
  const fontsDict = doc.context.obj({});
  fontsDict.set(PDFName.of('F1'), fontRef);
  resources.set(PDFName.of('Font'), fontsDict);
  page.node.set(PDFName.of('Resources'), resources);

  return doc;
}

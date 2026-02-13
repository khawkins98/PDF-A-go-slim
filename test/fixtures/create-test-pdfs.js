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

import { describe, it, expect } from 'vitest';
import { generateHtmlReport } from '../../src/ui/inspector.js';

/** Minimal stats object matching the shape produced by the pipeline. */
function makeStats({
  pageCount = 3,
  title = 'Test Document',
  author = 'Author Name',
  isTagged = false,
  pdfALevel = null,
  categories = null,
  passes = null,
} = {}) {
  const defaultCategories = [
    { label: 'Fonts', count: 2, totalSize: 8000, items: [
      { ref: '5 0 R', displayName: 'Arial', size: 5000 },
      { ref: '6 0 R', displayName: 'Times', size: 3000 },
    ]},
    { label: 'Images', count: 1, totalSize: 12000, items: [
      { ref: '7 0 R', displayName: 'Image 1', size: 12000 },
    ]},
    { label: 'Page Content', count: 3, totalSize: 900, items: [
      { ref: '8 0 R', displayName: 'Page 1', size: 300 },
      { ref: '9 0 R', displayName: 'Page 2', size: 300 },
      { ref: '10 0 R', displayName: 'Page 3', size: 300 },
    ]},
    { label: 'Metadata', count: 1, totalSize: 500, items: [
      { ref: '11 0 R', displayName: 'XMP', size: 500 },
    ]},
    { label: 'Document Structure', count: 2, totalSize: 200, items: [
      { ref: '1 0 R', displayName: 'Catalog', size: 100 },
      { ref: '2 0 R', displayName: 'Pages', size: 100 },
    ]},
    { label: 'Other Data', count: 1, totalSize: 400, items: [
      { ref: '12 0 R', displayName: 'ICC Profile', size: 400 },
    ]},
  ];

  const totalSize = (categories || defaultCategories).reduce((s, c) => s + c.totalSize, 0);
  const objectCount = (categories || defaultCategories).reduce((s, c) => s + c.count, 0);

  // After: simulate some savings (fonts smaller, metadata removed)
  const afterCategories = (categories || defaultCategories).map(c => {
    if (c.label === 'Fonts') return { ...c, totalSize: 6000, items: c.items.map(i => ({ ...i, size: i.size - 1000 })) };
    if (c.label === 'Metadata') return { ...c, count: 0, totalSize: 0, items: [] };
    return { ...c };
  });
  const afterTotal = afterCategories.reduce((s, c) => s + c.totalSize, 0);
  const afterCount = afterCategories.reduce((s, c) => s + c.count, 0);

  return {
    documentInfo: { pageCount, title, author, creator: 'TestCreator', producer: 'TestProducer' },
    pdfTraits: { isTagged, pdfALevel },
    inspect: {
      before: { totalSize, objectCount, categories: categories || defaultCategories },
      after: { totalSize: afterTotal, objectCount: afterCount, categories: afterCategories },
    },
    passes: passes || [
      { name: 'Recompressing streams', recompressed: 5 },
      { name: 'Stripping metadata', stripped: 3 },
    ],
  };
}

describe('generateHtmlReport', () => {
  it('returns null when stats lack inspect data', () => {
    expect(generateHtmlReport({}, 'test.pdf')).toBeNull();
    expect(generateHtmlReport({ inspect: {} }, 'test.pdf')).toBeNull();
    expect(generateHtmlReport({ inspect: { before: {} } }, 'test.pdf')).toBeNull();
  });

  it('generates a valid HTML document', () => {
    const html = generateHtmlReport(makeStats(), 'report.pdf');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('</html>');
  });

  it('includes the filename in the title and body', () => {
    const html = generateHtmlReport(makeStats(), 'my-document.pdf');
    expect(html).toContain('my-document.pdf');
    expect(html).toContain('<title>Inspector Report');
  });

  it('includes document info fields', () => {
    const html = generateHtmlReport(makeStats({ title: 'My Title', author: 'Jane Doe' }), 'test.pdf');
    expect(html).toContain('My Title');
    expect(html).toContain('Jane Doe');
    expect(html).toContain('TestCreator');
    expect(html).toContain('TestProducer');
  });

  it('includes savings percentage in summary', () => {
    const html = generateHtmlReport(makeStats(), 'test.pdf');
    // There should be a percentage and arrow showing reduction
    expect(html).toContain('% reduction');
    expect(html).toContain('&rarr;');
  });

  it('includes all category labels', () => {
    const html = generateHtmlReport(makeStats(), 'test.pdf');
    expect(html).toContain('Fonts');
    expect(html).toContain('Images');
    expect(html).toContain('Page Content');
    expect(html).toContain('Metadata');
    expect(html).toContain('Document Structure');
    expect(html).toContain('Other Data');
  });

  it('includes optimization pass results', () => {
    const html = generateHtmlReport(makeStats(), 'test.pdf');
    expect(html).toContain('Recompressing streams');
    expect(html).toContain('5 streams recompressed');
    expect(html).toContain('Stripping metadata');
    expect(html).toContain('3 metadata entries stripped');
  });

  it('shows "stream merged" for removed Page Content items', () => {
    const stats = makeStats();
    // Remove a page content item from the "after" snapshot
    const pageContentAfter = stats.inspect.after.categories.find(c => c.label === 'Page Content');
    pageContentAfter.items = pageContentAfter.items.filter(i => i.ref !== '10 0 R');
    pageContentAfter.count = 2;

    const html = generateHtmlReport(stats, 'test.pdf');
    expect(html).toContain('stream merged');
    // Extract just the Page Content section and verify it uses "stream merged", not "removed"
    const pageContentSection = html.split('Page Content')[1].split(/(?=<tr style="font-weight:600">)/)[0];
    expect(pageContentSection).toContain('stream merged');
    expect(pageContentSection).not.toContain('removed');
  });

  it('shows "removed" for items in non-Page-Content categories', () => {
    const stats = makeStats();
    // Remove a font from the "after" snapshot
    const fontsAfter = stats.inspect.after.categories.find(c => c.label === 'Fonts');
    fontsAfter.items = fontsAfter.items.filter(i => i.ref !== '6 0 R');
    fontsAfter.count = 1;

    const html = generateHtmlReport(stats, 'test.pdf');
    expect(html).toContain('removed');
  });

  it('includes accessibility traits when present', () => {
    const html = generateHtmlReport(makeStats({ isTagged: true, pdfALevel: '1b' }), 'test.pdf');
    expect(html).toContain('Tagged PDF');
    expect(html).toContain('Yes');
    expect(html).toContain('PDF/A');
    expect(html).toContain('1b');
  });

  it('escapes HTML in filenames and metadata', () => {
    const html = generateHtmlReport(
      makeStats({ title: '<script>alert("xss")</script>' }),
      '<img onerror=alert(1)>.pdf',
    );
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<img onerror');
    expect(html).toContain('&lt;script&gt;');
  });

  it('includes inline CSS for self-contained rendering', () => {
    const html = generateHtmlReport(makeStats(), 'test.pdf');
    expect(html).toContain('<style>');
    expect(html).toContain('font-family');
  });

  it('includes the generator footer', () => {
    const html = generateHtmlReport(makeStats(), 'test.pdf');
    expect(html).toContain('Generated by PDF-A-go-slim');
  });
});

import { describe, it, expect } from 'vitest';
import { formatSize, escapeHtml, buildDownloadName } from '../../src/ui/helpers.js';

describe('formatSize', () => {
  it('formats bytes', () => {
    expect(formatSize(0)).toBe('0 B');
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(1023)).toBe('1023 B');
  });

  it('formats kilobytes', () => {
    expect(formatSize(1024)).toBe('1.0 KB');
    expect(formatSize(1536)).toBe('1.5 KB');
    expect(formatSize(1024 * 100)).toBe('100.0 KB');
  });

  it('formats megabytes', () => {
    expect(formatSize(1024 * 1024)).toBe('1.0 MB');
    expect(formatSize(1024 * 1024 * 2.5)).toBe('2.5 MB');
  });
});

describe('escapeHtml', () => {
  it('escapes ampersands', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('escapes angle brackets', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
  });

  it('escapes quotes', () => {
    expect(escapeHtml('a "b" c')).toBe('a &quot;b&quot; c');
  });

  it('handles strings with no special characters', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });

  it('escapes multiple special characters', () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  });
});

describe('buildDownloadName', () => {
  it('produces lossless tag for non-lossy options', () => {
    const name = buildDownloadName('report.pdf', { lossy: false });
    expect(name).toMatch(/^report_lossless_\d{8}\.pdf$/);
  });

  it('produces lossy tag with quality and DPI', () => {
    const name = buildDownloadName('report.pdf', { lossy: true, imageQuality: 0.75, maxImageDpi: 150 });
    expect(name).toMatch(/^report_lossy-q75-150dpi_\d{8}\.pdf$/);
  });

  it('produces lossy tag without DPI when not set', () => {
    const name = buildDownloadName('report.pdf', { lossy: true, imageQuality: 0.92 });
    expect(name).toMatch(/^report_lossy-q92_\d{8}\.pdf$/);
  });

  it('defaults quality to 85 when imageQuality is null', () => {
    const name = buildDownloadName('report.pdf', { lossy: true });
    expect(name).toMatch(/^report_lossy-q85_\d{8}\.pdf$/);
  });

  it('strips .pdf extension case-insensitively', () => {
    const name = buildDownloadName('Report.PDF', { lossy: false });
    expect(name).toMatch(/^Report_lossless_\d{8}\.pdf$/);
  });

  it('handles filenames without .pdf extension', () => {
    const name = buildDownloadName('document', { lossy: false });
    expect(name).toMatch(/^document_lossless_\d{8}\.pdf$/);
  });
});

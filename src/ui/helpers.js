export function buildDownloadName(originalName, options) {
  const base = originalName.replace(/\.pdf$/i, '');

  let tag;
  if (options.lossy) {
    const q = options.imageQuality != null ? Math.round(options.imageQuality * 100) : 85;
    const dpi = options.maxImageDpi || '';
    tag = `lossy-q${q}${dpi ? `-${dpi}dpi` : ''}`;
  } else {
    tag = 'lossless';
  }

  const now = new Date();
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;

  return `${base}_${tag}_${date}.pdf`;
}

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Minimal markdown → HTML renderer.
 * Supports: headings, bold/italic, links, inline code, fenced code blocks,
 * unordered/ordered lists, tables, horizontal rules, paragraphs.
 */
export function renderMarkdown(md) {
  const lines = md.split('\n');
  const out = [];
  let i = 0;

  function inline(text) {
    return text
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>');
  }

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.startsWith('```')) {
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(escapeHtml(lines[i]));
        i++;
      }
      i++; // skip closing ```
      out.push(`<pre><code>${codeLines.join('\n')}</code></pre>`);
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      out.push(`<h${level}>${inline(headingMatch[2])}</h${level}>`);
      i++;
      continue;
    }

    // Table (detect header row with pipes)
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:-]+\|/.test(lines[i + 1])) {
      const headers = line.split('|').map(c => c.trim()).filter(Boolean);
      i += 2; // skip header + separator
      let tableHtml = '<table><thead><tr>';
      headers.forEach(h => { tableHtml += `<th>${inline(h)}</th>`; });
      tableHtml += '</tr></thead><tbody>';
      while (i < lines.length && lines[i].includes('|')) {
        const cells = lines[i].split('|').map(c => c.trim()).filter(Boolean);
        tableHtml += '<tr>';
        cells.forEach(c => { tableHtml += `<td>${inline(c)}</td>`; });
        tableHtml += '</tr>';
        i++;
      }
      tableHtml += '</tbody></table>';
      out.push(tableHtml);
      continue;
    }

    // Unordered list
    if (/^[\s]*[-*+]\s/.test(line)) {
      out.push('<ul>');
      while (i < lines.length && /^[\s]*[-*+]\s/.test(lines[i])) {
        out.push(`<li>${inline(lines[i].replace(/^[\s]*[-*+]\s+/, ''))}</li>`);
        i++;
      }
      out.push('</ul>');
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s/.test(line)) {
      out.push('<ol>');
      while (i < lines.length && /^\s*\d+\.\s/.test(lines[i])) {
        out.push(`<li>${inline(lines[i].replace(/^\s*\d+\.\s+/, ''))}</li>`);
        i++;
      }
      out.push('</ol>');
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Paragraph (default)
    out.push(`<p>${inline(line)}</p>`);
    i++;
  }

  return out.join('\n');
}

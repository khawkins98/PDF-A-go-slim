/**
 * PDF reference graph walker.
 *
 * Walks from trailer Root / Info / Encrypt entries, recursively traversing
 * PDFDict, PDFArray, and PDFRef values. Returns a Set<string> of all
 * reachable ref tags (e.g. "1 0 R").
 */
import { PDFDict, PDFArray, PDFRef, PDFStream } from 'pdf-lib';

/**
 * Collect all refs reachable from the document trailer.
 * @param {PDFContext} context
 * @returns {Set<string>} Set of ref tags like "1 0 R"
 */
export function findReachableRefs(context) {
  const visited = new Set();
  const queue = [];

  // Seed from trailer entries
  const trailer = context.trailerInfo;
  const roots = ['Root', 'Info', 'Encrypt', 'ID'];
  for (const key of roots) {
    const val = trailer[key];
    if (val) queue.push(val);
  }

  while (queue.length > 0) {
    const item = queue.pop();

    if (item instanceof PDFRef) {
      const tag = item.tag;
      if (visited.has(tag)) continue;
      visited.add(tag);

      // Resolve the ref and traverse its value
      const resolved = context.lookup(item);
      if (resolved) queue.push(resolved);
      continue;
    }

    if (item instanceof PDFDict) {
      const entries = item.entries();
      for (const [, value] of entries) {
        queue.push(value);
      }
      continue;
    }

    if (item instanceof PDFArray) {
      for (let i = 0; i < item.size(); i++) {
        queue.push(item.get(i));
      }
      continue;
    }

    if (item instanceof PDFStream) {
      // The dict part of a stream may contain refs (catches PDFRawStream,
      // PDFFlateStream, PDFContentStream, and any future subclass)
      queue.push(item.dict);
      continue;
    }
  }

  return visited;
}

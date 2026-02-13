/**
 * Unreferenced object removal.
 *
 * Compares the set of reachable refs against all indirect objects and
 * deletes unreachable ones. Must run last in the pipeline.
 */
import { findReachableRefs } from '../utils/pdf-traversal.js';

/**
 * Remove all indirect objects not reachable from the document trailer.
 * @param {PDFDocument} pdfDoc
 * @returns {{ removed: number, total: number }}
 */
export function removeUnreferencedObjects(pdfDoc) {
  const context = pdfDoc.context;
  const reachable = findReachableRefs(context);

  let removed = 0;
  let total = 0;

  for (const [ref] of context.enumerateIndirectObjects()) {
    total++;
    if (!reachable.has(ref.tag)) {
      context.delete(ref);
      removed++;
    }
  }

  return { removed, total };
}

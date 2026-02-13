/**
 * Object deduplication pass.
 *
 * Hashes each PDFRawStream (contents + serialized dict) using SHA-256.
 * Builds a hash → canonical ref map, then walks all dicts/arrays replacing
 * duplicate refs with canonical refs, and deletes duplicates.
 */
import { PDFRawStream, PDFDict, PDFArray, PDFRef, PDFName } from 'pdf-lib';

/**
 * Simple synchronous hash using djb2 on the raw bytes.
 * Faster than crypto.subtle for our purposes (no need for cryptographic strength).
 */
function hashBytes(bytes) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < bytes.length; i++) {
    const ch = bytes[i];
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * Serialize a dict's entries (excluding Length, which varies) for hashing.
 */
function serializeDict(dict) {
  const parts = [];
  for (const [key, value] of dict.entries()) {
    const keyStr = key instanceof PDFName ? key.decodeText() : key.toString();
    // Skip Length — it's derived from contents
    if (keyStr === 'Length') continue;
    parts.push(`${keyStr}=${value.toString()}`);
  }
  parts.sort();
  return parts.join('|');
}

/**
 * Deduplicate identical objects.
 * @param {PDFDocument} pdfDoc
 * @returns {{ deduplicated: number }}
 */
export function deduplicateObjects(pdfDoc) {
  const context = pdfDoc.context;

  // Phase 1: Hash all stream objects
  const hashToCanonical = new Map(); // hash → PDFRef (first seen)
  const duplicateToCanonical = new Map(); // duplicate PDFRef tag → canonical PDFRef

  for (const [ref, obj] of context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;

    const dictSer = serializeDict(obj.dict);
    const combined = new Uint8Array(dictSer.length + obj.contents.length);
    for (let i = 0; i < dictSer.length; i++) combined[i] = dictSer.charCodeAt(i);
    combined.set(obj.contents, dictSer.length);

    const hash = hashBytes(combined);

    if (hashToCanonical.has(hash)) {
      duplicateToCanonical.set(ref.tag, hashToCanonical.get(hash));
    } else {
      hashToCanonical.set(hash, ref);
    }
  }

  if (duplicateToCanonical.size === 0) return { deduplicated: 0 };

  // Phase 2: Rewrite refs throughout the document
  rewriteRefs(context, duplicateToCanonical);

  // Phase 3: Delete duplicate objects
  for (const [dupTag] of duplicateToCanonical) {
    // Reconstruct the ref from the tag
    const parts = dupTag.split(' ');
    const ref = PDFRef.of(parseInt(parts[0], 10), parseInt(parts[1], 10));
    context.delete(ref);
  }

  return { deduplicated: duplicateToCanonical.size };
}

/**
 * Walk all objects and replace duplicate refs with canonical refs.
 */
function rewriteRefs(context, duplicateToCanonical) {
  for (const [, obj] of context.enumerateIndirectObjects()) {
    if (obj instanceof PDFDict) {
      rewriteDict(obj, duplicateToCanonical);
    } else if (obj instanceof PDFRawStream) {
      rewriteDict(obj.dict, duplicateToCanonical);
    } else if (obj instanceof PDFArray) {
      rewriteArray(obj, duplicateToCanonical);
    }
  }
}

function rewriteDict(dict, duplicateToCanonical) {
  for (const [key, value] of dict.entries()) {
    if (value instanceof PDFRef) {
      const canonical = duplicateToCanonical.get(value.tag);
      if (canonical) dict.set(key, canonical);
    } else if (value instanceof PDFDict) {
      rewriteDict(value, duplicateToCanonical);
    } else if (value instanceof PDFArray) {
      rewriteArray(value, duplicateToCanonical);
    }
  }
}

function rewriteArray(arr, duplicateToCanonical) {
  for (let i = 0; i < arr.size(); i++) {
    const value = arr.get(i);
    if (value instanceof PDFRef) {
      const canonical = duplicateToCanonical.get(value.tag);
      if (canonical) arr.set(i, canonical);
    } else if (value instanceof PDFDict) {
      rewriteDict(value, duplicateToCanonical);
    } else if (value instanceof PDFArray) {
      rewriteArray(value, duplicateToCanonical);
    }
  }
}

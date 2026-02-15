/**
 * Shared hashing utility and font-related constants.
 */

/**
 * Simple synchronous hash using djb2 variant on the raw bytes.
 * Faster than crypto.subtle for our purposes (no need for cryptographic strength).
 * @param {Uint8Array} bytes
 * @returns {string} Base-36 hash string
 */
export function hashBytes(bytes) {
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

/** Font stream dictionary keys that reference embedded font programs. */
export const FONT_FILE_KEYS = ['FontFile', 'FontFile2', 'FontFile3'];

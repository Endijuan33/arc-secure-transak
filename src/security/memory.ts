/**
 * Low-level memory hygiene helpers.
 *
 * JavaScript gives no way to force-erase an immutable `string`, so the vault
 * never stores key material as a string: it lives only inside `Uint8Array`
 * buffers that these helpers can overwrite in place before the reference is
 * dropped. Overwriting is done with random bytes first and zeros second so a
 * post-mortem heap dump cannot distinguish a wiped buffer from an unused one.
 */

/** Overwrite `buffer` in place with random bytes, then zeros. */
export function secureZeroMemory(buffer: Uint8Array): void {
  if (buffer.byteLength === 0) return;
  try {
    crypto.getRandomValues(buffer);
  } catch {
    buffer.fill(0xff);
  }
  buffer.fill(0);
}

/** Wipe every buffer in the list, tolerating already-detached entries. */
export function secureZeroAll(buffers: readonly Uint8Array[]): void {
  for (const buffer of buffers) {
    try {
      secureZeroMemory(buffer);
    } catch {
      // A detached ArrayBuffer cannot be written to; it is already unreachable.
    }
  }
}

const HEX_ALPHABET = '0123456789abcdef';

/**
 * Convert bytes to a lowercase `0x`-prefixed hex string.
 *
 * The returned string is immutable and therefore un-wipeable, so this is only
 * used at the single boundary where ethers.js requires a private key string.
 */
export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    out += HEX_ALPHABET[(byte >> 4) & 0x0f];
    out += HEX_ALPHABET[byte & 0x0f];
  }
  return `0x${out}`;
}

/** Parse a `0x`-prefixed or bare hex string into bytes. Throws on malformed input. */
export function hexToBytes(hex: string): Uint8Array {
  const body = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
  if (body.length === 0 || body.length % 2 !== 0) {
    throw new Error('Invalid hex string: length must be a positive multiple of two.');
  }
  const bytes = new Uint8Array(body.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = Number.parseInt(body.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error('Invalid hex string: contains non-hexadecimal characters.');
    }
    bytes[i] = byte;
  }
  return bytes;
}

/** Constant-time equality check for two byte arrays. */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i += 1) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

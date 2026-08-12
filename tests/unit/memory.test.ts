import { describe, expect, it } from 'vitest';
import {
  bytesToHex,
  hexToBytes,
  secureZeroAll,
  secureZeroMemory,
  timingSafeEqual,
} from '../../src/security/memory';

describe('secureZeroMemory', () => {
  it('leaves every byte zero', () => {
    const buffer = new Uint8Array([1, 2, 3, 4, 5]);
    secureZeroMemory(buffer);
    expect([...buffer]).toEqual([0, 0, 0, 0, 0]);
  });

  it('handles an empty buffer without throwing', () => {
    expect(() => secureZeroMemory(new Uint8Array(0))).not.toThrow();
  });

  it('zeroes a large buffer completely', () => {
    const buffer = new Uint8Array(4096).fill(0xaa);
    secureZeroMemory(buffer);
    expect(buffer.every((byte) => byte === 0)).toBe(true);
  });
});

describe('secureZeroAll', () => {
  it('zeroes every buffer in the list', () => {
    const a = new Uint8Array([9, 9]);
    const b = new Uint8Array([7, 7, 7]);
    secureZeroAll([a, b]);
    expect([...a, ...b]).toEqual([0, 0, 0, 0, 0]);
  });

  it('continues past a detached buffer', () => {
    const detached = new Uint8Array(new ArrayBuffer(4));
    const survivor = new Uint8Array([5, 5]);
    // Structured-clone transfer detaches the underlying ArrayBuffer, so writing
    // to `detached` now throws — the helper must not abort the whole sweep.
    structuredClone(detached.buffer, { transfer: [detached.buffer] });
    expect(() => secureZeroAll([detached, survivor])).not.toThrow();
    expect([...survivor]).toEqual([0, 0]);
  });
});

describe('bytesToHex and hexToBytes', () => {
  it('round-trips arbitrary bytes', () => {
    const original = new Uint8Array([0x00, 0x0f, 0x10, 0xff, 0x7b]);
    const hex = bytesToHex(original);
    expect(hex).toBe('0x000f10ff7b');
    expect([...hexToBytes(hex)]).toEqual([...original]);
  });

  it('pads single-digit bytes', () => {
    expect(bytesToHex(new Uint8Array([1, 2]))).toBe('0x0102');
  });

  it('accepts hex without the 0x prefix', () => {
    expect([...hexToBytes('ff00')]).toEqual([255, 0]);
  });

  it('accepts an uppercase 0X prefix', () => {
    expect([...hexToBytes('0XFF')]).toEqual([255]);
  });

  it('round-trips a full 32-byte key', () => {
    const key = crypto.getRandomValues(new Uint8Array(32));
    expect([...hexToBytes(bytesToHex(key))]).toEqual([...key]);
  });

  it.each([
    ['empty', ''],
    ['odd length', '0xabc'],
    ['non-hex characters', '0xzzzz'],
    ['only a prefix', '0x'],
  ])('rejects %s', (_label, input) => {
    expect(() => hexToBytes(input)).toThrow();
  });
});

describe('timingSafeEqual', () => {
  it('returns true for identical content', () => {
    expect(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
  });

  it('returns false when a byte differs', () => {
    expect(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
  });

  it('returns false for different lengths', () => {
    expect(timingSafeEqual(new Uint8Array([1]), new Uint8Array([1, 2]))).toBe(false);
  });

  it('returns true for two empty buffers', () => {
    expect(timingSafeEqual(new Uint8Array(0), new Uint8Array(0))).toBe(true);
  });
});

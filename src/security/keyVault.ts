/**
 * Encrypted ephemeral key vault.
 *
 * Design constraints this module exists to satisfy:
 *
 *  1. The burner private key is never a module-level or global variable. It is
 *     held inside a closure created per session and reachable only through an
 *     opaque `SessionHandle`. The handle-to-state mapping lives in a `WeakMap`,
 *     so once the caller drops the handle the record becomes unreachable and
 *     collectable without any explicit bookkeeping.
 *
 *  2. The key is stored encrypted at rest in memory with AES-256-GCM. The
 *     wrapping key is a non-extractable `CryptoKey` generated per session, so
 *     the plaintext bytes exist only for the microseconds inside `withKey`.
 *     A heap snapshot taken between operations yields ciphertext plus a
 *     `CryptoKey` whose material the JS heap does not contain.
 *
 *  3. Every plaintext buffer is wiped with `secureZeroMemory` in a `finally`
 *     block, so an exception thrown by the caller cannot leak a live buffer.
 *
 *  4. Nothing here writes to `localStorage`, `sessionStorage`, IndexedDB,
 *     cookies, or the console. The vault is memory-only by construction.
 */

import { secureZeroMemory } from './memory';

/** Opaque token identifying a vault session. Carries no key material itself. */
export interface SessionHandle {
  readonly sessionId: string;
  readonly createdAt: number;
}

interface VaultRecord {
  /** Non-extractable AES-GCM wrapping key, unique to this session. */
  readonly wrappingKey: CryptoKey;
  /** AES-GCM nonce; regenerated on every re-seal. */
  iv: Uint8Array;
  /** Encrypted private-key bytes. */
  ciphertext: Uint8Array;
  /** Public burner address; not secret, safe to expose for recovery messaging. */
  readonly address: string;
  destroyed: boolean;
  /** Incremented on each unseal; used by tests and diagnostics. */
  accessCount: number;
}

const AES_GCM_IV_BYTES = 12;
const AES_KEY_BITS = 256;

/**
 * The single source of truth for live sessions.
 *
 * `WeakMap` is deliberate: it holds no strong reference to the handle, so a
 * dropped handle makes the record collectable even if `destroy` was never
 * called. It is also not enumerable, so no code path can iterate over all live
 * sessions and harvest keys.
 */
const vault = new WeakMap<SessionHandle, VaultRecord>();

function requireSubtleCrypto(): SubtleCrypto {
  const subtle: SubtleCrypto | undefined = globalThis.crypto?.subtle;
  if (subtle === undefined) {
    throw new Error(
      'Web Crypto (crypto.subtle) is unavailable. A secure context (HTTPS or localhost) is required.',
    );
  }
  return subtle;
}

function randomIv(): Uint8Array {
  const iv = new Uint8Array(AES_GCM_IV_BYTES);
  crypto.getRandomValues(iv);
  return iv;
}

/**
 * `crypto.subtle` accepts a `BufferSource`. `Uint8Array` from a typed-array
 * constructor may be backed by a `SharedArrayBuffer` under TS 5.9's stricter
 * lib types, so views are normalised to a plain `ArrayBuffer` copy at the
 * boundary. The copy is wiped by the caller together with the source.
 */
function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(view.byteLength);
  new Uint8Array(copy).set(view);
  return copy;
}

/** Generate a fresh, non-extractable AES-256-GCM wrapping key. */
async function generateWrappingKey(): Promise<CryptoKey> {
  const key = await requireSubtleCrypto().generateKey(
    { name: 'AES-GCM', length: AES_KEY_BITS },
    false, // not extractable: the raw bytes can never be read back out
    ['encrypt', 'decrypt'],
  );
  if (key instanceof CryptoKey) return key;
  throw new Error('Web Crypto returned an unexpected key type for AES-GCM.');
}

async function seal(
  wrappingKey: CryptoKey,
  iv: Uint8Array,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  const ivBuffer = toArrayBuffer(iv);
  const plaintextBuffer = toArrayBuffer(plaintext);
  try {
    const sealed = await requireSubtleCrypto().encrypt(
      { name: 'AES-GCM', iv: ivBuffer },
      wrappingKey,
      plaintextBuffer,
    );
    return new Uint8Array(sealed);
  } finally {
    secureZeroMemory(new Uint8Array(plaintextBuffer));
  }
}

async function unseal(
  wrappingKey: CryptoKey,
  iv: Uint8Array,
  ciphertext: Uint8Array,
): Promise<Uint8Array> {
  const opened = await requireSubtleCrypto().decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    wrappingKey,
    toArrayBuffer(ciphertext),
  );
  return new Uint8Array(opened);
}

function newSessionId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let id = '';
  for (const byte of bytes) id += byte.toString(16).padStart(2, '0');
  return id;
}

/**
 * Encrypt `privateKeyBytes` into a new session.
 *
 * Ownership of `privateKeyBytes` transfers to the vault: the buffer is wiped
 * before this function returns, whether it succeeds or throws. Callers must not
 * reuse it afterwards.
 */
export async function createSession(
  privateKeyBytes: Uint8Array,
  address: string,
): Promise<SessionHandle> {
  try {
    if (privateKeyBytes.byteLength !== 32) {
      throw new Error('A secp256k1 private key must be exactly 32 bytes.');
    }
    const wrappingKey = await generateWrappingKey();
    const iv = randomIv();
    const ciphertext = await seal(wrappingKey, iv, privateKeyBytes);
    const handle: SessionHandle = Object.freeze({
      sessionId: newSessionId(),
      createdAt: Date.now(),
    });
    vault.set(handle, {
      wrappingKey,
      iv,
      ciphertext,
      address,
      destroyed: false,
      accessCount: 0,
    });
    return handle;
  } finally {
    secureZeroMemory(privateKeyBytes);
  }
}

function requireRecord(handle: SessionHandle): VaultRecord {
  const record = vault.get(handle);
  if (record === undefined) {
    throw new Error('Vault session not found. It was destroyed or never created.');
  }
  if (record.destroyed) {
    throw new Error('Vault session has been destroyed and cannot be reopened.');
  }
  return record;
}

/**
 * Decrypt the key, hand it to `fn`, and wipe it before returning.
 *
 * `fn` receives a live buffer that is zeroed the moment it returns. It must not
 * retain the reference, and must not convert it to a string except at the one
 * ethers.js boundary in `burner.service.ts`. After `fn` completes the vault
 * re-seals under a fresh IV, so identical plaintext never produces repeating
 * ciphertext across the session lifetime.
 */
export async function withKey<T>(
  handle: SessionHandle,
  fn: (privateKeyBytes: Uint8Array) => Promise<T> | T,
): Promise<T> {
  const record = requireRecord(handle);
  const plaintext = await unseal(record.wrappingKey, record.iv, record.ciphertext);
  record.accessCount += 1;
  try {
    return await fn(plaintext);
  } finally {
    const nextIv = randomIv();
    try {
      const resealed = await seal(record.wrappingKey, nextIv, plaintext);
      secureZeroMemory(record.iv);
      secureZeroMemory(record.ciphertext);
      record.iv = nextIv;
      record.ciphertext = resealed;
    } catch {
      // Re-sealing failed; the original ciphertext is still valid, so keep it.
      secureZeroMemory(nextIv);
    }
    secureZeroMemory(plaintext);
  }
}

/** The burner's public address. Not secret. */
export function getSessionAddress(handle: SessionHandle): string {
  return requireRecord(handle).address;
}

/** Whether the handle still maps to a live, non-destroyed session. */
export function isSessionAlive(handle: SessionHandle): boolean {
  const record = vault.get(handle);
  return record !== undefined && !record.destroyed;
}

/** Number of successful `withKey` unseals. Diagnostics only. */
export function getSessionAccessCount(handle: SessionHandle): number {
  return requireRecord(handle).accessCount;
}

/**
 * Wipe the ciphertext and IV, mark the session dead, and drop the WeakMap
 * entry. Idempotent, and safe to call from a `finally` block.
 */
export function destroySession(handle: SessionHandle): void {
  const record = vault.get(handle);
  if (record === undefined) return;
  secureZeroMemory(record.iv);
  secureZeroMemory(record.ciphertext);
  record.destroyed = true;
  vault.delete(handle);
}

/**
 * Reveal the private key as a hex string for the user-gated recovery escape
 * hatch. Every call is an explicit, deliberate downgrade of the memory-safety
 * guarantee, so it is isolated here rather than inlined at a call site.
 *
 * Callers must render the result in a modal the user opened on purpose, must
 * never log it, and must drop the reference as soon as the modal closes. The
 * returned string is immutable and cannot be wiped.
 */
export async function revealPrivateKeyForRecovery(handle: SessionHandle): Promise<string> {
  const { bytesToHex } = await import('./memory');
  return withKey(handle, (bytes) => bytesToHex(bytes));
}

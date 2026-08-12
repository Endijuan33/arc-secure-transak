/**
 * Vitest global setup.
 *
 * Runs in the Node realm (see the `environment` note in `vite.config.ts`), so
 * three browser APIs the code under test depends on have to be supplied. Each
 * is a real implementation rather than a mock, so the tests exercise the same
 * code paths a browser would.
 *
 *  1. `crypto.subtle` — Node's `webcrypto` is the same WebCrypto API the vault
 *     uses in the browser, so it is installed directly when absent.
 *
 *  2. `localStorage` / `sessionStorage` — Node 26 defines an experimental
 *     `localStorage` getter on `globalThis` that resolves to `undefined` unless
 *     the process was started with `--localstorage-file`. A spec-shaped
 *     in-memory `Storage` is installed over it.
 *
 *  3. `indexedDB` — supplied by `fake-indexeddb`, a complete spec-compliant
 *     implementation, for the transaction-history store.
 */

import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

// --- WebCrypto -----------------------------------------------------------
if (globalThis.crypto?.subtle === undefined) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
    writable: true,
  });
}

// --- Web Storage ---------------------------------------------------------

/** A minimal, spec-shaped `Storage` backed by a `Map`. */
function createMemoryStorage(): Storage {
  const entries = new Map<string, string>();

  return {
    get length(): number {
      return entries.size;
    },
    clear(): void {
      entries.clear();
    },
    getItem(key: string): string | null {
      return entries.get(String(key)) ?? null;
    },
    key(index: number): string | null {
      return [...entries.keys()][index] ?? null;
    },
    removeItem(key: string): void {
      entries.delete(String(key));
    },
    setItem(key: string, value: string): void {
      entries.set(String(key), String(value));
    },
  };
}

function installStorage(name: 'localStorage' | 'sessionStorage'): void {
  const existing: unknown = Reflect.get(globalThis, name);
  const usable =
    typeof existing === 'object' &&
    existing !== null &&
    typeof (existing as Storage).setItem === 'function';
  if (usable) return;

  Object.defineProperty(globalThis, name, {
    value: createMemoryStorage(),
    configurable: true,
    writable: true,
  });
}

installStorage('localStorage');
installStorage('sessionStorage');

// --- Per-test isolation --------------------------------------------------
beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

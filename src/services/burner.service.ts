/**
 * Burner wallet lifecycle.
 *
 * The private key never exists as a long-lived variable. Generation produces raw
 * bytes that are handed straight to the vault, and every signing operation
 * reconstructs a short-lived `Wallet` inside `withKey`, which is destroyed and
 * whose key buffer is wiped before the call returns.
 *
 * The `Wallet` object itself does hold the key as an immutable string for its
 * lifetime — that is unavoidable with ethers.js. What this module guarantees is
 * that the lifetime is one operation long and that no reference outlives it.
 */

import { Wallet, type HDNodeWallet, type JsonRpcProvider, type TransactionResponse } from 'ethers';
import {
  createSession,
  destroySession,
  getSessionAddress,
  withKey,
  type SessionHandle,
} from '../security/keyVault';
import { bytesToHex, hexToBytes, secureZeroMemory } from '../security/memory';

export interface BurnerSession {
  readonly handle: SessionHandle;
  readonly address: string;
}

/**
 * Create a burner wallet and seal its key in the vault.
 *
 * `Wallet.createRandom()` draws from `crypto.getRandomValues` via ethers'
 * `randomBytes`. The intermediate mnemonic and key string are dropped
 * immediately; only the byte copy reaches the vault, which wipes it after
 * encrypting.
 */
export async function createBurnerSession(): Promise<BurnerSession> {
  const generated: HDNodeWallet = Wallet.createRandom();
  const address = generated.address;
  const keyBytes = hexToBytes(generated.privateKey);
  try {
    const handle = await createSession(keyBytes, address);
    return { handle, address };
  } catch (error: unknown) {
    secureZeroMemory(keyBytes);
    throw error;
  }
}

/**
 * Run `fn` with a signer for the burner, then tear the signer down.
 *
 * The `Wallet` is constructed inside `withKey`, so the plaintext key exists only
 * within this scope. `fn` must not retain the wallet reference.
 */
export async function withBurnerSigner<T>(
  session: BurnerSession,
  provider: JsonRpcProvider,
  fn: (wallet: Wallet) => Promise<T>,
): Promise<T> {
  return withKey(session.handle, async (keyBytes) => {
    const hex = bytesToHex(keyBytes);
    const wallet = new Wallet(hex, provider);
    if (wallet.address.toLowerCase() !== session.address.toLowerCase()) {
      // A mismatch means the vault returned the wrong key material. Refusing to
      // sign is the only safe response: signing would send assets to an address
      // whose key we do not hold.
      throw new Error('Burner key integrity check failed: derived address does not match.');
    }
    return fn(wallet);
  });
}

/** Send one transaction from the burner. */
export async function sendFromBurner(
  session: BurnerSession,
  provider: JsonRpcProvider,
  build: (wallet: Wallet) => Promise<TransactionResponse>,
): Promise<TransactionResponse> {
  return withBurnerSigner(session, provider, build);
}

/** The burner's public address, or `null` once the session is destroyed. */
export function burnerAddress(session: BurnerSession): string | null {
  try {
    return getSessionAddress(session.handle);
  } catch {
    return null;
  }
}

/** Wipe the session. Idempotent and safe from a `finally` block. */
export function destroyBurnerSession(session: BurnerSession): void {
  destroySession(session.handle);
}

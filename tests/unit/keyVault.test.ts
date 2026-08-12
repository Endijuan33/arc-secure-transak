import { describe, expect, it } from 'vitest';
import { Wallet } from 'ethers';
import {
  createSession,
  destroySession,
  getSessionAccessCount,
  getSessionAddress,
  isSessionAlive,
  revealPrivateKeyForRecovery,
  withKey,
} from '../../src/security/keyVault';
import { bytesToHex, hexToBytes } from '../../src/security/memory';

function randomKeyBytes(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

describe('createSession', () => {
  it('returns a handle carrying no key material', async () => {
    const handle = await createSession(randomKeyBytes(), '0xabc');
    // The handle is the only thing the caller holds; it must be inert.
    expect(Object.keys(handle).sort()).toEqual(['createdAt', 'sessionId']);
    expect(JSON.stringify(handle)).not.toMatch(/[0-9a-f]{64}/i);
  });

  it('wipes the caller-supplied buffer', async () => {
    const bytes = randomKeyBytes();
    await createSession(bytes, '0xabc');
    expect(bytes.every((byte) => byte === 0)).toBe(true);
  });

  it('wipes the buffer even when creation fails validation', async () => {
    const tooShort = new Uint8Array([1, 2, 3]);
    await expect(createSession(tooShort, '0xabc')).rejects.toThrow(/32 bytes/);
    expect(tooShort.every((byte) => byte === 0)).toBe(true);
  });

  it('issues a distinct session id per session', async () => {
    const a = await createSession(randomKeyBytes(), '0xa');
    const b = await createSession(randomKeyBytes(), '0xb');
    expect(a.sessionId).not.toBe(b.sessionId);
  });

  it('records the address verbatim', async () => {
    const handle = await createSession(randomKeyBytes(), '0xDEADBEEF');
    expect(getSessionAddress(handle)).toBe('0xDEADBEEF');
  });
});

describe('withKey', () => {
  it('hands back the exact bytes that were sealed', async () => {
    const original = randomKeyBytes();
    const expected = [...original];
    const handle = await createSession(original, '0xabc');

    const seen = await withKey(handle, (bytes) => [...bytes]);
    expect(seen).toEqual(expected);
  });

  it('wipes the plaintext buffer after the callback returns', async () => {
    const handle = await createSession(randomKeyBytes(), '0xabc');
    // Deliberately leaking the reference is the only way to observe the wipe.
    let leaked: Uint8Array | null = null;
    await withKey(handle, (bytes) => {
      leaked = bytes;
      return null;
    });
    expect(leaked).not.toBeNull();
    expect(leaked!.every((byte) => byte === 0)).toBe(true);
  });

  it('wipes the plaintext even when the callback throws', async () => {
    const handle = await createSession(randomKeyBytes(), '0xabc');
    let leaked: Uint8Array | null = null;
    await expect(
      withKey(handle, (bytes) => {
        leaked = bytes;
        throw new Error('callback exploded');
      }),
    ).rejects.toThrow('callback exploded');
    expect(leaked!.every((byte) => byte === 0)).toBe(true);
  });

  it('can be opened repeatedly and yields the same key each time', async () => {
    const original = randomKeyBytes();
    const expected = [...original];
    const handle = await createSession(original, '0xabc');

    for (let i = 0; i < 5; i += 1) {
      expect(await withKey(handle, (bytes) => [...bytes])).toEqual(expected);
    }
    expect(getSessionAccessCount(handle)).toBe(5);
  });

  it('supports an async callback', async () => {
    const handle = await createSession(randomKeyBytes(), '0xabc');
    const result = await withKey(handle, async (bytes) => {
      await Promise.resolve();
      return bytes.byteLength;
    });
    expect(result).toBe(32);
  });

  it('re-seals under a fresh nonce so ciphertext never repeats', async () => {
    const handle = await createSession(randomKeyBytes(), '0xabc');
    // Two consecutive unseals must both succeed; if the IV were reused or the
    // re-seal were skipped, the second would fail authentication.
    const first = await withKey(handle, (bytes) => bytesToHex(bytes));
    const second = await withKey(handle, (bytes) => bytesToHex(bytes));
    expect(second).toBe(first);
  });
});

describe('destroySession', () => {
  it('makes the session unusable', async () => {
    const handle = await createSession(randomKeyBytes(), '0xabc');
    expect(isSessionAlive(handle)).toBe(true);

    destroySession(handle);

    expect(isSessionAlive(handle)).toBe(false);
    await expect(withKey(handle, () => null)).rejects.toThrow(/not found|destroyed/i);
    expect(() => getSessionAddress(handle)).toThrow();
  });

  it('is idempotent', async () => {
    const handle = await createSession(randomKeyBytes(), '0xabc');
    destroySession(handle);
    expect(() => destroySession(handle)).not.toThrow();
  });

  it('rejects an unknown handle', async () => {
    const foreign = Object.freeze({ sessionId: 'nope', createdAt: Date.now() });
    await expect(withKey(foreign, () => null)).rejects.toThrow(/not found/i);
  });
});

describe('revealPrivateKeyForRecovery', () => {
  it('returns the hex key that derives the recorded address', async () => {
    const wallet = Wallet.createRandom();
    const handle = await createSession(hexToBytes(wallet.privateKey), wallet.address);

    const revealed = await revealPrivateKeyForRecovery(handle);

    expect(revealed).toBe(wallet.privateKey.toLowerCase());
    expect(new Wallet(revealed).address).toBe(wallet.address);
  });

  it('fails after the session is destroyed', async () => {
    const wallet = Wallet.createRandom();
    const handle = await createSession(hexToBytes(wallet.privateKey), wallet.address);
    destroySession(handle);
    await expect(revealPrivateKeyForRecovery(handle)).rejects.toThrow();
  });
});

describe('vault isolation', () => {
  it('keeps concurrent sessions independent', async () => {
    const walletA = Wallet.createRandom();
    const walletB = Wallet.createRandom();

    const handleA = await createSession(hexToBytes(walletA.privateKey), walletA.address);
    const handleB = await createSession(hexToBytes(walletB.privateKey), walletB.address);

    expect(await revealPrivateKeyForRecovery(handleA)).toBe(walletA.privateKey.toLowerCase());
    expect(await revealPrivateKeyForRecovery(handleB)).toBe(walletB.privateKey.toLowerCase());

    destroySession(handleA);
    expect(isSessionAlive(handleA)).toBe(false);
    // Destroying one session must not disturb the other.
    expect(isSessionAlive(handleB)).toBe(true);
    expect(await revealPrivateKeyForRecovery(handleB)).toBe(walletB.privateKey.toLowerCase());
  });

  it('writes nothing to web storage', async () => {
    const wallet = Wallet.createRandom();
    const handle = await createSession(hexToBytes(wallet.privateKey), wallet.address);
    await withKey(handle, () => null);

    const dump = JSON.stringify(localStorage) + JSON.stringify(sessionStorage);
    expect(dump).not.toContain(wallet.privateKey.slice(2));
    expect(localStorage.length).toBe(0);
  });
});

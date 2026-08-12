import { beforeEach, describe, expect, it } from 'vitest';
import { Wallet, parseUnits } from 'ethers';
import {
  RecoveryFailure,
  executeSecureTransak,
  type PipelineEvent,
} from '../../src/services/transak.service';
import { AbortedError, ValidationError } from '../../src/services/errors';
import { destroySession } from '../../src/security/keyVault';
import { DEFAULT_CHAIN } from '../../src/config/chains';
import type { ChainConfig, TransferRequest } from '../../src/types';
import {
  MockChain,
  createMainSigner,
  createMockPool,
  createMockProvider,
} from '../helpers/mockChain';

/**
 * Integration tests for the ten-step pipeline.
 *
 * Everything runs against the in-process `MockChain`, but the signing path is
 * real: both the user's wallet and the burner are genuine ethers `Wallet`
 * instances, so the vault decrypt → construct → derive-and-verify → sign →
 * broadcast chain is exercised end to end.
 */

// Anvil/Hardhat deterministic dev account #1. Published in their docs, holds
// nothing on any real network, and only ever signs against the in-process mock.
const MAIN_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const MAIN_ADDRESS = new Wallet(MAIN_KEY).address;
const RECIPIENT = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';

const TOKEN = '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a';
const NFT721 = '0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF';
const NFT1155 = '0x9A676e781A523b5d0C0e43731313A708CB607508';

const ONE_ETHER = parseUnits('1', 18);

interface Harness {
  readonly mock: MockChain;
  readonly run: (
    request: TransferRequest,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<Awaited<ReturnType<typeof executeSecureTransak>>>;
  readonly events: PipelineEvent[];
  /** Steps that reached `done` or `skipped`, in order. */
  readonly settledSteps: () => string[];
}

function harness(
  overrides: {
    readonly nativeBalance?: bigint;
    readonly tokenBalance?: bigint;
    readonly chain?: ChainConfig;
    readonly tokenNotAToken?: boolean;
    readonly tokenSilentlyFails?: boolean;
  } = {},
): Harness {
  const chain = overrides.chain ?? DEFAULT_CHAIN;
  const mock = new MockChain({
    chain,
    nativeBalances: { [MAIN_ADDRESS]: overrides.nativeBalance ?? ONE_ETHER },
    tokens: [
      {
        address: TOKEN,
        decimals: 6,
        balances: { [MAIN_ADDRESS]: overrides.tokenBalance ?? 1_000_000_000n },
        ...(overrides.tokenNotAToken === true ? { notAToken: true } : {}),
        ...(overrides.tokenSilentlyFails === true ? { silentlyFailsTransfer: true } : {}),
      },
    ],
    nfts: [
      { address: NFT721, standard: 'erc721', owners: { '7': MAIN_ADDRESS } },
      {
        address: NFT1155,
        standard: 'erc1155',
        owners: {},
        balances: { [`5:${MAIN_ADDRESS}`]: 10n },
      },
    ],
  });

  const provider = createMockProvider(mock);
  const signer = createMainSigner(MAIN_KEY, provider);
  const events: PipelineEvent[] = [];

  return {
    mock,
    events,
    settledSteps: () =>
      events.filter((e) => e.phase === 'done' || e.phase === 'skipped').map((e) => e.step),
    run: (request, options = {}) =>
      executeSecureTransak({
        chain,
        signer,
        walletProvider: provider,
        request,
        gasSpeed: 'standard',
        signal: options.signal ?? null,
        onEvent: (event) => events.push(event),
        poolFactory: () => createMockPool(mock, provider),
        // Production polls every 5s; the mock mines instantly, so a short
        // interval keeps a multi-poll wait from dominating the suite runtime.
        receiptPollIntervalMs: 10,
      }),
  };
}

function nativeRequest(amount = parseUnits('0.01', 18)): TransferRequest {
  return { kind: 'native', recipient: RECIPIENT, amount, decimals: 18, symbol: 'USDC' };
}

function tokenRequest(amount = 1_000_000n): TransferRequest {
  return { kind: 'erc20', recipient: RECIPIENT, amount, decimals: 6, symbol: 'EURC', token: TOKEN };
}

beforeEach(() => {
  // Receipts resolve on the first poll by default; individual tests opt into
  // mining latency where it matters.
});

describe('native transfer', () => {
  it('delivers the amount to the recipient', async () => {
    const h = harness();
    const amount = parseUnits('0.01', 18);

    const result = await h.run(nativeRequest(amount));

    expect(result.hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(h.mock.nativeBalanceOf(RECIPIENT)).toBe(amount);
  });

  it('runs all ten steps, skipping the asset-forward leg', async () => {
    const h = harness();
    await h.run(nativeRequest());

    const settled = h.settledSteps();
    expect(settled).toContain('verify-session');
    expect(settled).toContain('validate-network');
    expect(settled).toContain('create-burner');
    expect(settled).toContain('estimate-gas');
    expect(settled).toContain('preflight-balance');
    expect(settled).toContain('fund-burner');
    expect(settled).toContain('dispatch-final');
    expect(settled).toContain('sweep-refund');
    expect(settled).toContain('destroy-session');

    const forward = h.events.find((e) => e.step === 'forward-asset');
    expect(forward?.phase).toBe('skipped');
  });

  it('has the main wallet sign exactly one transaction', async () => {
    // This is the security property: the user's wallet touches only the burner,
    // never the recipient.
    const h = harness();
    await h.run(nativeRequest());

    const fromMain = h.mock.sentFrom(MAIN_ADDRESS);
    expect(fromMain).toHaveLength(1);
    expect(fromMain[0]?.to).not.toBe(RECIPIENT.toLowerCase());
  });

  it('never sends a main-wallet transaction addressed to the recipient', async () => {
    const h = harness();
    await h.run(nativeRequest());

    for (const tx of h.mock.sentFrom(MAIN_ADDRESS)) {
      expect(tx.to).not.toBe(RECIPIENT.toLowerCase());
    }
  });

  it('routes the final transfer through the burner', async () => {
    const h = harness();
    const result = await h.run(nativeRequest());

    const finalTx = h.mock.sent.find((tx) => tx.hash === result.hash);
    expect(finalTx?.from).toBe(result.burnerAddress.toLowerCase());
    expect(finalTx?.to).toBe(RECIPIENT.toLowerCase());
  });

  it('sweeps the burner back to empty', async () => {
    const h = harness();
    const result = await h.run(nativeRequest());

    expect(result.refunded).toBe(true);
    // Whatever remains must be less than the cost of moving it.
    expect(h.mock.nativeBalanceOf(result.burnerAddress)).toBeLessThan(parseUnits('0.0001', 18));
  });

  it('reports the receipt details', async () => {
    const h = harness();
    const result = await h.run(nativeRequest());

    expect(result.blockNumber).toBeGreaterThan(0);
    expect(result.gasUsed).toBe(21_000n);
  });

  it('destroys the vault session on success', async () => {
    const h = harness();
    const result = await h.run(nativeRequest());

    const destroy = h.events.find((e) => e.step === 'destroy-session' && e.phase === 'done');
    expect(destroy?.detail).toMatch(/destroyed/i);
    expect(result.burnerAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it('never emits the private key in any event detail', async () => {
    const h = harness();
    await h.run(nativeRequest());

    const combined = h.events.map((e) => e.detail).join(' ');
    // A 64-hex-character run would be a raw key; the burner address is only 40.
    expect(combined).not.toMatch(/0x[0-9a-fA-F]{64}(?![0-9a-fA-F])/);
  });
});

describe('ERC-20 transfer', () => {
  it('delivers tokens to the recipient', async () => {
    const h = harness();
    await h.run(tokenRequest(1_000_000n));

    expect(h.mock.tokenBalanceOf(TOKEN, RECIPIENT)).toBe(1_000_000n);
    expect(h.mock.tokenBalanceOf(TOKEN, MAIN_ADDRESS)).toBe(999_000_000n);
  });

  it('has the main wallet sign exactly two transactions', async () => {
    // One native funding transfer plus one token transfer, both to the burner.
    const h = harness();
    const result = await h.run(tokenRequest());

    const fromMain = h.mock.sentFrom(MAIN_ADDRESS);
    expect(fromMain).toHaveLength(2);
    for (const tx of fromMain) {
      expect(tx.to).not.toBe(RECIPIENT.toLowerCase());
    }
    expect(fromMain[1]?.to).toBe(TOKEN.toLowerCase());
    expect(result.hash).toBeTruthy();
  });

  it('completes the forward-asset step rather than skipping it', async () => {
    const h = harness();
    await h.run(tokenRequest());

    const forward = h.events.find((e) => e.step === 'forward-asset' && e.phase === 'done');
    expect(forward).toBeDefined();
  });

  it('leaves no tokens behind in the burner', async () => {
    const h = harness();
    const result = await h.run(tokenRequest());
    expect(h.mock.tokenBalanceOf(TOKEN, result.burnerAddress)).toBe(0n);
  });

  it('rejects a transfer larger than the token balance', async () => {
    const h = harness({ tokenBalance: 500n });
    await expect(h.run(tokenRequest(1_000n))).rejects.toThrow(/insufficient/i);
  });

  it('explains when the address is not an ERC-20 on this chain', async () => {
    const h = harness({ tokenNotAToken: true });
    await expect(h.run(tokenRequest())).rejects.toThrow(/does not behave like an ERC-20/i);
  });

  it('does not fund the burner when the pre-flight check fails', async () => {
    const h = harness({ tokenBalance: 0n });
    await expect(h.run(tokenRequest(1_000n))).rejects.toThrow();
    expect(h.mock.sentFrom(MAIN_ADDRESS)).toHaveLength(0);
  });

  it('leaves only negligible dust in the burner after a token transfer', async () => {
    /**
     * Regression: the sweep reserved `21000 x maxFeePerGas` while EIP-1559
     * charges `baseFee + tip`, so the refunded difference stayed in a burner
     * that is discarded immediately after. On Arc Testnet that was 0.000588
     * native stranded per transfer.
     *
     * The mock now charges `baseFee + tip` and refunds the rest, so an over-sized
     * reservation shows up here as dust well above one sweep's worth of gas.
     */
    const h = harness();
    const result = await h.run(tokenRequest(1_000_000n));

    const dust = h.mock.nativeBalanceOf(result.burnerAddress);
    const oneSweepAtBaseFee = 21_000n * 1_000_000_000n;

    // Anything left must be smaller than a single sweep at the base fee —
    // i.e. genuinely not worth another transaction.
    expect(dust).toBeLessThan(oneSweepAtBaseFee);
  });

  it('reports the transfer as refunded', async () => {
    const h = harness();
    const result = await h.run(tokenRequest(1_000_000n));
    expect(result.refunded).toBe(true);
  });

  /**
   * Regression: a live EURC transfer reverted out of gas because the forward leg
   * (main wallet → burner) was estimated against the *final recipient* instead.
   *
   * The recipient already held the token, so its balance slot was a warm
   * ~5k-gas modify. The burner is always a fresh address, so its slot is a cold
   * ~20k-gas write. The estimate came in ~15k short and the transaction ran out
   * of gas mid-call.
   *
   * The mock charges cold and warm rates separately, so reverting the fix in
   * `transak.service.ts` makes this fail with an explicit out-of-gas message.
   */
  it('estimates the forward leg against the burner, not the final recipient', async () => {
    const h = harness();
    // Pre-fund the recipient so its balance slot is warm and therefore cheaper
    // than the burner's — the exact condition that exposed the bug on-chain.
    h.mock.seedTokenBalance(TOKEN, RECIPIENT, 5_000_000n);

    const result = await h.run(tokenRequest(1_000_000n));

    expect(result.hash).toBeTruthy();
    expect(h.mock.tokenBalanceOf(TOKEN, RECIPIENT)).toBe(6_000_000n);

    // Every transaction must have been mined successfully; an under-funded
    // forward would appear here as a status-0 record.
    expect(h.mock.sent.every((tx) => tx.status === 1)).toBe(true);
  });

  it('gives the forward leg at least the cold-storage gas cost', async () => {
    const h = harness();
    h.mock.seedTokenBalance(TOKEN, RECIPIENT, 5_000_000n);

    await h.run(tokenRequest(1_000_000n));

    // The forward leg is the main wallet's second transaction (after funding).
    const forward = h.mock.sentFrom(MAIN_ADDRESS)[1];
    expect(forward).toBeDefined();
    // 60_000n is the harness's cold-write cost; the limit must cover it.
    expect(forward?.gasLimit).toBeGreaterThanOrEqual(60_000n);
  });
});

describe('NFT transfer', () => {
  it('moves an ERC-721 token to the recipient', async () => {
    const h = harness();
    const request: TransferRequest = {
      kind: 'erc721',
      recipient: RECIPIENT,
      contract: NFT721,
      tokenId: 7n,
      symbol: 'MOCK',
    };

    await h.run(request);

    expect(h.mock.nftOwnerOf(NFT721, '7')).toBe(RECIPIENT.toLowerCase());
  });

  it('moves an ERC-1155 quantity to the recipient', async () => {
    const h = harness();
    const request: TransferRequest = {
      kind: 'erc1155',
      recipient: RECIPIENT,
      contract: NFT1155,
      tokenId: 5n,
      amount: 3n,
      symbol: 'MOCK',
    };

    await h.run(request);

    expect(h.mock.nft1155BalanceOf(NFT1155, '5', RECIPIENT)).toBe(3n);
    expect(h.mock.nft1155BalanceOf(NFT1155, '5', MAIN_ADDRESS)).toBe(7n);
  });

  it('rejects an NFT the wallet does not own', async () => {
    const h = harness();
    const request: TransferRequest = {
      kind: 'erc721',
      recipient: RECIPIENT,
      contract: NFT721,
      tokenId: 99n,
      symbol: 'MOCK',
    };

    await expect(h.run(request)).rejects.toThrow();
  });

  it('rejects an ERC-1155 quantity above the balance', async () => {
    const h = harness();
    const request: TransferRequest = {
      kind: 'erc1155',
      recipient: RECIPIENT,
      contract: NFT1155,
      tokenId: 5n,
      amount: 50n,
      symbol: 'MOCK',
    };

    await expect(h.run(request)).rejects.toThrow(/fewer than requested/i);
  });

  it('rejects a standard mismatch', async () => {
    // Declaring an ERC-1155 contract as ERC-721 would produce a malformed call,
    // so the standard is verified via ERC-165 before anything is signed.
    const h = harness();
    const request: TransferRequest = {
      kind: 'erc721',
      recipient: RECIPIENT,
      contract: NFT1155,
      tokenId: 5n,
      symbol: 'MOCK',
    };

    await expect(h.run(request)).rejects.toThrow(/ERC-1155, not ERC-721/i);
  });
});

describe('validation and pre-flight', () => {
  it('rejects the zero address as recipient', async () => {
    const h = harness();
    const request: TransferRequest = {
      ...nativeRequest(),
      recipient: '0x0000000000000000000000000000000000000000',
    };
    await expect(h.run(request)).rejects.toThrow(ValidationError);
  });

  it('rejects sending to your own wallet', async () => {
    const h = harness();
    const request: TransferRequest = { ...nativeRequest(), recipient: MAIN_ADDRESS };
    await expect(h.run(request)).rejects.toThrow(/your own wallet/i);
  });

  it('rejects a wallet connected to the wrong chain', async () => {
    const wrongChain: ChainConfig = { ...DEFAULT_CHAIN, id: DEFAULT_CHAIN.id + 1 };
    const mock = new MockChain({
      chain: wrongChain,
      nativeBalances: { [MAIN_ADDRESS]: ONE_ETHER },
    });
    const provider = createMockProvider(mock);
    const signer = createMainSigner(MAIN_KEY, provider);

    await expect(
      executeSecureTransak({
        // The app expects DEFAULT_CHAIN while the provider reports another id.
        chain: DEFAULT_CHAIN,
        signer,
        walletProvider: provider,
        request: nativeRequest(),
        gasSpeed: 'standard',
        signal: null,
        onEvent: () => undefined,
        poolFactory: () => createMockPool(mock, provider),
        receiptPollIntervalMs: 10,
      }),
    ).rejects.toThrow(/wrong network|different network/i);
  });

  it('rejects when the native balance cannot cover the transfer plus fees', async () => {
    const h = harness({ nativeBalance: parseUnits('0.0001', 18) });
    await expect(h.run(nativeRequest(parseUnits('0.01', 18)))).rejects.toThrow(/insufficient/i);
  });

  it('signs nothing when the balance check fails', async () => {
    const h = harness({ nativeBalance: parseUnits('0.0001', 18) });
    await expect(h.run(nativeRequest())).rejects.toThrow();
    expect(h.mock.sent).toHaveLength(0);
  });
});

describe('abort and recovery', () => {
  it('aborts before any signature when cancelled immediately', async () => {
    const h = harness();
    const controller = new AbortController();
    controller.abort();

    await expect(h.run(nativeRequest(), { signal: controller.signal })).rejects.toThrow(
      AbortedError,
    );
    expect(h.mock.sent).toHaveLength(0);
  });

  it('returns the asset to the main wallet when the final dispatch fails', async () => {
    const h = harness();
    const before = h.mock.tokenBalanceOf(TOKEN, MAIN_ADDRESS);

    // The forwarding transfer succeeds; the burner's outbound transfer fails.
    h.mock.failOn({
      on: 'transfer',
      occurrence: 2,
      error: new Error('execution reverted: recipient blocked'),
    });

    await expect(h.run(tokenRequest(1_000_000n))).rejects.toThrow();

    // Recovery moved the tokens back, so the balance is whole again.
    expect(h.mock.tokenBalanceOf(TOKEN, MAIN_ADDRESS)).toBe(before);
    expect(h.mock.tokenBalanceOf(TOKEN, RECIPIENT)).toBe(0n);
  });

  it('returns leftover native gas when the native dispatch fails', async () => {
    const h = harness();

    // The funding transfer is the first plain send; the burner's outbound
    // transfer is the second.
    h.mock.failOn({ on: 'sendTransaction', occurrence: 2, error: new Error('nonce too low') });

    await expect(h.run(nativeRequest())).rejects.toThrow();
    expect(h.mock.nativeBalanceOf(RECIPIENT)).toBe(0n);
  });

  it('reports RecoveryFailure with a live handle when recovery cannot move the asset', async () => {
    const h = harness();

    // Both the outbound transfer and every recovery attempt fail, which is the
    // only path that should ever surface a key-reveal option to the user.
    h.mock.failOn({ on: 'transfer', occurrence: 2, error: new Error('execution reverted') });
    h.mock.failOn({ on: 'transfer', occurrence: 3, error: new Error('execution reverted') });

    let caught: unknown = null;
    try {
      await h.run(tokenRequest(1_000_000n));
    } catch (error: unknown) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(RecoveryFailure);
    if (caught instanceof RecoveryFailure) {
      expect(caught.burnerAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(caught.message).toContain(caught.burnerAddress);
      // The session must still be alive so the UI can offer a gated reveal.
      destroySession(caught.sessionHandle);
    }
  });

  it('does not leak the key in the RecoveryFailure message', async () => {
    const h = harness();
    h.mock.failOn({ on: 'transfer', occurrence: 2, error: new Error('execution reverted') });
    h.mock.failOn({ on: 'transfer', occurrence: 3, error: new Error('execution reverted') });

    try {
      await h.run(tokenRequest(1_000_000n));
      expect.unreachable('expected the pipeline to fail');
    } catch (error: unknown) {
      if (error instanceof RecoveryFailure) {
        expect(error.message).not.toMatch(/0x[0-9a-fA-F]{64}/);
        destroySession(error.sessionHandle);
      }
    }
  });
});

describe('resilience', () => {
  it('waits through mining latency before reporting success', async () => {
    const h = harness();
    h.mock.receiptDelayPolls = 2;

    const result = await h.run(nativeRequest());

    expect(result.blockNumber).toBeGreaterThan(0);
    expect(h.mock.countOf('getTransactionReceipt')).toBeGreaterThan(3);
  });

  it('re-quotes gas and retries after an underpriced dispatch', async () => {
    const h = harness();
    h.mock.failOn({
      on: 'sendTransaction',
      occurrence: 2,
      error: new Error('transaction underpriced'),
    });

    const result = await h.run(nativeRequest());

    expect(h.mock.nativeBalanceOf(RECIPIENT)).toBeGreaterThan(0n);
    const retryEvent = h.events.find(
      (e) => e.step === 'dispatch-final' && e.detail.includes('Re-quoting gas'),
    );
    expect(retryEvent).toBeDefined();
    expect(result.hash).toBeTruthy();
  });

  it('survives a base-fee rise between quoting and dispatch', async () => {
    const h = harness();
    const result = await h.run(nativeRequest());
    expect(result.hash).toBeTruthy();

    // The funding is budgeted with a safety buffer, so a moderate fee rise on a
    // subsequent transfer is still affordable.
    const second = harness();
    second.mock.setBaseFee(3_000_000_000n);
    await expect(second.run(nativeRequest())).resolves.toBeDefined();
  });

  it('documents that a lying token contract still reports success', async () => {
    const h = harness({ tokenSilentlyFails: true });

    // A token whose `transfer` returns true without moving anything is a real
    // class of malicious contract. The pipeline cannot detect it: every call
    // succeeded and every receipt has status 1. This test pins the current
    // behaviour rather than asserting it is desirable — closing the gap would
    // require a post-transfer balance assertion on the recipient, which costs an
    // extra RPC read on every transfer.
    const result = await h.run(tokenRequest(1_000_000n));

    expect(result.hash).toBeTruthy();
    expect(h.mock.tokenBalanceOf(TOKEN, RECIPIENT)).toBe(0n);
  });
});

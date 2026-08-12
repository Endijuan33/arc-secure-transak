/**
 * In-process mock EVM.
 *
 * Substitutes for a real chain so the ten-step pipeline can be driven through
 * every branch — including ones that are impractical to reproduce against a live
 * node: an RPC that rate-limits on the third call, a transfer that reverts only
 * when sent from the burner, a receipt that never arrives.
 *
 * What it models faithfully:
 *  - Native and ERC-20/721/1155 balances, mutated by transactions.
 *  - Nonces, gas accounting, and fee deduction from the sender.
 *  - Receipts appearing only after a transaction is "mined".
 *  - Per-method failure injection and call counting.
 *
 * What it deliberately does not model: real EVM execution, signature recovery,
 * and block production. Those are the parts a real node would provide and are
 * out of scope for testing the pipeline's control flow.
 */

import {
  Interface,
  Network,
  Transaction,
  Wallet,
  getAddress,
  type JsonRpcSigner,
  type Provider,
} from 'ethers';
import type { ChainConfig, RpcEndpoint } from '../../src/types';
import { ERC1155_ABI, ERC20_ABI, ERC721_ABI, INTERFACE_ID } from '../../src/config/abi';
import type { RpcPool } from '../../src/services/rpc.service';

const ERC20 = new Interface(ERC20_ABI);
const ERC721 = new Interface(ERC721_ABI);
const ERC1155 = new Interface(ERC1155_ABI);

/** ERC-20 transfer into an address that already holds a non-zero balance. */
const WARM_ERC20_TRANSFER_GAS = 45_000n;
/** ERC-20 transfer into an address whose balance is currently zero. */
const COLD_ERC20_TRANSFER_GAS = 60_000n;

/**
 * Raised when a call is given less gas than it needs.
 *
 * Shaped like a real out-of-gas revert: the transaction was mined and consumed
 * the whole limit, but no state changed. The message includes the numbers so a
 * failing test says why rather than just "reverted".
 */
export class OutOfGasError extends Error {
  override readonly name = 'OutOfGasError';

  constructor(
    readonly hash: string,
    readonly gasLimit: bigint,
    readonly gasRequired: bigint,
  ) {
    super(
      `execution reverted: out of gas (limit ${gasLimit.toString()}, required ${gasRequired.toString()})`,
    );
  }
}

export interface MockTokenConfig {
  readonly address: string;
  readonly decimals: number;
  /** Initial holder balances, keyed by address. */
  readonly balances: Readonly<Record<string, bigint>>;
  /** When true, `transfer` returns success without moving anything. */
  readonly silentlyFailsTransfer?: boolean;
  /** When true, `balanceOf` reverts with a decode-shaped error. */
  readonly notAToken?: boolean;
}

export interface MockNftConfig {
  readonly address: string;
  readonly standard: 'erc721' | 'erc1155';
  /** ERC-721: tokenId to owner. ERC-1155: `tokenId:owner` to amount. */
  readonly owners: Readonly<Record<string, string>>;
  readonly balances?: Readonly<Record<string, bigint>>;
}

export interface MockChainOptions {
  readonly chain: ChainConfig;
  readonly nativeBalances?: Readonly<Record<string, bigint>>;
  readonly tokens?: readonly MockTokenConfig[];
  readonly nfts?: readonly MockNftConfig[];
  readonly baseFeeWei?: bigint;
  readonly supportsEip1559?: boolean;
}

export interface SentTransaction {
  readonly hash: string;
  readonly from: string;
  readonly to: string;
  readonly value: bigint;
  readonly data: string;
  readonly nonce: number;
  readonly gasLimit: bigint;
  readonly gasUsed: bigint;
  readonly blockNumber: number;
  readonly status: 0 | 1;
}

/** A scripted failure for one logical operation. */
export interface FailureRule {
  /** Operation to fail: an RPC method name or a contract method name. */
  readonly on: string;
  /** Fail only on this 1-based occurrence. Omit to fail every time. */
  readonly occurrence?: number;
  readonly error: unknown;
}

export class MockChain {
  readonly chain: ChainConfig;
  private readonly native = new Map<string, bigint>();
  private readonly tokens = new Map<string, MockTokenConfig>();
  private readonly tokenBalances = new Map<string, Map<string, bigint>>();
  private readonly nfts = new Map<string, MockNftConfig>();
  private readonly nftOwners = new Map<string, Map<string, string>>();
  private readonly nftBalances = new Map<string, Map<string, bigint>>();
  private readonly nonces = new Map<string, number>();

  readonly sent: SentTransaction[] = [];
  readonly callCounts = new Map<string, number>();
  private readonly failures: FailureRule[] = [];

  private blockNumber = 1_000;
  private baseFee: bigint;
  private readonly eip1559: boolean;

  /** Receipts are withheld until this many polls, simulating mining latency. */
  receiptDelayPolls = 0;
  private readonly receiptPolls = new Map<string, number>();

  constructor(options: MockChainOptions) {
    this.chain = options.chain;
    this.baseFee = options.baseFeeWei ?? 1_000_000_000n;
    this.eip1559 = options.supportsEip1559 ?? options.chain.supportsEip1559;

    for (const [address, balance] of Object.entries(options.nativeBalances ?? {})) {
      this.native.set(this.key(address), balance);
    }
    for (const token of options.tokens ?? []) {
      const key = this.key(token.address);
      this.tokens.set(key, token);
      const balances = new Map<string, bigint>();
      for (const [holder, amount] of Object.entries(token.balances)) {
        balances.set(this.key(holder), amount);
      }
      this.tokenBalances.set(key, balances);
    }
    for (const nft of options.nfts ?? []) {
      const key = this.key(nft.address);
      this.nfts.set(key, nft);
      const owners = new Map<string, string>();
      for (const [tokenId, owner] of Object.entries(nft.owners)) {
        owners.set(tokenId, this.key(owner));
      }
      this.nftOwners.set(key, owners);

      const balances = new Map<string, bigint>();
      for (const [composite, amount] of Object.entries(nft.balances ?? {})) {
        const [tokenId = '', holder = ''] = composite.split(':');
        balances.set(`${tokenId}:${this.key(holder)}`, amount);
      }
      this.nftBalances.set(key, balances);
    }
  }

  private key(address: string): string {
    return address.toLowerCase();
  }

  /**
   * Gas an ERC-20 transfer consumes, modelling cold vs warm storage.
   *
   * Writing a balance to an address that currently holds zero costs a cold
   * `SSTORE` (~20k on a real EVM); updating an existing non-zero balance is a
   * warm modify (~5k). Reproducing that asymmetry is what lets the harness catch
   * a gas estimate taken against the wrong destination — the bug that made a
   * live EURC forward revert out of gas.
   */
  private erc20TransferGas(token: string, to: string): bigint {
    return this.tokenBalanceOf(token, to) > 0n ? WARM_ERC20_TRANSFER_GAS : COLD_ERC20_TRANSFER_GAS;
  }

  // --- Inspection --------------------------------------------------------

  /** Set a holder's token balance directly, without a transaction. */
  seedTokenBalance(token: string, holder: string, amount: bigint): void {
    const key = this.key(token);
    const balances = this.tokenBalances.get(key);
    if (balances === undefined) {
      throw new Error(`Token ${token} is not configured in this mock chain.`);
    }
    balances.set(this.key(holder), amount);
  }

  nativeBalanceOf(address: string): bigint {
    return this.native.get(this.key(address)) ?? 0n;
  }

  tokenBalanceOf(token: string, address: string): bigint {
    return this.tokenBalances.get(this.key(token))?.get(this.key(address)) ?? 0n;
  }

  nftOwnerOf(contract: string, tokenId: string): string | null {
    return this.nftOwners.get(this.key(contract))?.get(tokenId) ?? null;
  }

  nft1155BalanceOf(contract: string, tokenId: string, holder: string): bigint {
    return this.nftBalances.get(this.key(contract))?.get(`${tokenId}:${this.key(holder)}`) ?? 0n;
  }

  countOf(operation: string): number {
    return this.callCounts.get(operation) ?? 0;
  }

  /** Transactions sent from a given address, in order. */
  sentFrom(address: string): readonly SentTransaction[] {
    return this.sent.filter((tx) => tx.from === this.key(address));
  }

  // --- Failure injection -------------------------------------------------

  failOn(rule: FailureRule): void {
    this.failures.push(rule);
  }

  /** Raise the base fee, simulating congestion between quote and dispatch. */
  setBaseFee(wei: bigint): void {
    this.baseFee = wei;
  }

  private track(operation: string): number {
    const next = (this.callCounts.get(operation) ?? 0) + 1;
    this.callCounts.set(operation, next);
    return next;
  }

  private maybeFail(operation: string): void {
    const count = this.track(operation);
    for (const rule of this.failures) {
      if (rule.on !== operation) continue;
      if (rule.occurrence !== undefined && rule.occurrence !== count) continue;
      throw rule.error;
    }
  }

  // --- Chain mechanics ---------------------------------------------------

  /**
   * Per-gas price a transaction is actually charged.
   *
   * Models EIP-1559 faithfully: a type-2 sender pays `baseFee + tip` capped at
   * `maxFeePerGas`, and the difference is refunded. Charging at `maxFeePerGas` —
   * which this harness previously did — makes every refund invisible, which is
   * precisely why the stranded-dust bug passed 316 tests while losing 0.000588
   * native per transfer on Arc Testnet.
   */
  private feeFor(overrides: Record<string, unknown>): bigint {
    const maxFee = overrides['maxFeePerGas'];
    const priority = overrides['maxPriorityFeePerGas'];
    const gasPrice = overrides['gasPrice'];

    if (typeof maxFee === 'bigint') {
      const tip = typeof priority === 'bigint' ? priority : 0n;
      const charged = this.baseFee + tip;
      return charged > maxFee ? maxFee : charged;
    }
    // Legacy transactions are charged exactly gasPrice; no refund exists.
    if (typeof gasPrice === 'bigint') return gasPrice;
    return this.baseFee;
  }

  private credit(address: string, amount: bigint): void {
    const key = this.key(address);
    this.native.set(key, (this.native.get(key) ?? 0n) + amount);
  }

  private debit(address: string, amount: bigint): void {
    const key = this.key(address);
    const current = this.native.get(key) ?? 0n;
    if (current < amount) {
      throw new Error('insufficient funds for intrinsic transaction cost');
    }
    this.native.set(key, current - amount);
  }

  private nextNonce(address: string): number {
    const key = this.key(address);
    const current = this.nonces.get(key) ?? 0;
    this.nonces.set(key, current + 1);
    return current;
  }

  private newHash(): string {
    const seed = (this.sent.length + 1).toString(16).padStart(8, '0');
    return `0x${seed.repeat(8)}`;
  }

  private record(
    from: string,
    to: string,
    value: bigint,
    data: string,
    overrides: Record<string, unknown>,
    gasUsed: bigint,
    status: 0 | 1 = 1,
  ): SentTransaction {
    const gasLimitRaw = overrides['gasLimit'];
    const gasLimit = typeof gasLimitRaw === 'bigint' ? gasLimitRaw : 100_000n;
    const feeCost = gasUsed * this.feeFor(overrides);

    // --- Admission check -------------------------------------------------
    //
    // A node will not admit a transaction unless the sender can cover the worst
    // case: `value + gasLimit * maxFeePerGas`. The EIP-1559 refund is credited
    // only after inclusion, so it cannot fund the transaction that produces it.
    //
    // Modelling this matters. Without it, a sweep that reserved less than the
    // ceiling looked fine here while a real node rejected it, and the whole
    // burner balance — 0.0081 native — was stranded on Arc Testnet.
    const maxFeeRaw = overrides['maxFeePerGas'];
    const gasPriceRaw = overrides['gasPrice'];
    const worstCasePerGas =
      typeof maxFeeRaw === 'bigint'
        ? maxFeeRaw
        : typeof gasPriceRaw === 'bigint'
          ? gasPriceRaw
          : this.baseFee;
    const required = value + gasLimit * worstCasePerGas;
    const available = this.native.get(this.key(from)) ?? 0n;
    if (available < required) {
      throw new Error(
        `insufficient funds for gas * price + value: balance ${available.toString()}, ` +
          `required ${required.toString()}`,
      );
    }

    // The sender pays value plus the fee actually charged.
    this.debit(from, value + feeCost);
    if (value > 0n) this.credit(to, value);

    this.blockNumber += 1;
    const tx: SentTransaction = {
      hash: this.newHash(),
      from: this.key(from),
      to: this.key(to),
      value,
      data,
      nonce: this.nextNonce(from),
      gasLimit,
      gasUsed,
      blockNumber: this.blockNumber,
      status,
    };
    this.sent.push(tx);
    return tx;
  }

  // --- Contract dispatch -------------------------------------------------

  private decodeCall(
    to: string,
    data: string,
  ): {
    readonly kind: 'erc20' | 'erc721' | 'erc1155';
    readonly name: string;
    readonly args: readonly unknown[];
  } | null {
    const key = this.key(to);

    if (this.tokens.has(key)) {
      const parsed = ERC20.parseTransaction({ data });
      if (parsed !== null) return { kind: 'erc20', name: parsed.name, args: parsed.args.toArray() };
    }
    const nft = this.nfts.get(key);
    if (nft !== undefined) {
      const iface = nft.standard === 'erc721' ? ERC721 : ERC1155;
      const parsed = iface.parseTransaction({ data });
      if (parsed !== null) {
        return { kind: nft.standard, name: parsed.name, args: parsed.args.toArray() };
      }
    }
    return null;
  }

  private applyErc20Transfer(token: string, from: string, to: string, amount: bigint): void {
    const key = this.key(token);
    const config = this.tokens.get(key);
    if (config === undefined) throw new Error('missing revert data');
    if (config.silentlyFailsTransfer === true) return;

    const balances = this.tokenBalances.get(key);
    if (balances === undefined) throw new Error('missing revert data');

    const fromKey = this.key(from);
    const current = balances.get(fromKey) ?? 0n;
    if (current < amount) {
      throw new Error('execution reverted: transfer amount exceeds balance');
    }
    balances.set(fromKey, current - amount);
    const toKey = this.key(to);
    balances.set(toKey, (balances.get(toKey) ?? 0n) + amount);
  }

  private applyErc721Transfer(contract: string, from: string, to: string, tokenId: string): void {
    const owners = this.nftOwners.get(this.key(contract));
    if (owners === undefined) throw new Error('missing revert data');
    if (owners.get(tokenId) !== this.key(from)) {
      throw new Error('execution reverted: caller is not token owner');
    }
    owners.set(tokenId, this.key(to));
  }

  private applyErc1155Transfer(
    contract: string,
    from: string,
    to: string,
    tokenId: string,
    amount: bigint,
  ): void {
    const balances = this.nftBalances.get(this.key(contract));
    if (balances === undefined) throw new Error('missing revert data');

    const fromKey = `${tokenId}:${this.key(from)}`;
    const current = balances.get(fromKey) ?? 0n;
    if (current < amount) throw new Error('execution reverted: insufficient balance for transfer');
    balances.set(fromKey, current - amount);

    const toKey = `${tokenId}:${this.key(to)}`;
    balances.set(toKey, (balances.get(toKey) ?? 0n) + amount);
  }

  /** Execute a call that mutates state, as a transaction. */
  execute(
    from: string,
    to: string,
    value: bigint,
    data: string,
    overrides: Record<string, unknown>,
  ): SentTransaction {
    if (data === '0x' || data.length <= 2) {
      this.maybeFail('sendTransaction');
      return this.record(from, to, value, data, overrides, 21_000n);
    }

    const call = this.decodeCall(to, data);
    if (call === null) throw new Error('missing revert data');
    this.maybeFail(call.name);

    switch (call.kind) {
      case 'erc20': {
        const [recipient, amount] = call.args as [string, bigint];
        // Cost is measured BEFORE the transfer, because the storage slot's
        // cold/warm state at execution time is what the EVM charges for.
        const gasCost = this.erc20TransferGas(to, recipient);
        const gasLimitRaw = overrides['gasLimit'];
        const gasLimit = typeof gasLimitRaw === 'bigint' ? gasLimitRaw : gasCost;
        if (gasLimit < gasCost) {
          // Out of gas: the transaction is mined, consumes the whole limit, and
          // reverts without applying any state change.
          const reverted = this.record(from, to, 0n, data, overrides, gasLimit, 0);
          throw new OutOfGasError(reverted.hash, gasLimit, gasCost);
        }
        this.applyErc20Transfer(to, from, recipient, amount);
        return this.record(from, to, 0n, data, overrides, gasCost);
      }
      case 'erc721': {
        const [owner, recipient, tokenId] = call.args as [string, string, bigint];
        this.applyErc721Transfer(to, owner, recipient, tokenId.toString());
        return this.record(from, to, 0n, data, overrides, 85_000n);
      }
      case 'erc1155': {
        const [owner, recipient, tokenId, amount] = call.args as [string, string, bigint, bigint];
        this.applyErc1155Transfer(to, owner, recipient, tokenId.toString(), amount);
        return this.record(from, to, 0n, data, overrides, 110_000n);
      }
    }
  }

  /** Execute a read-only call and return encoded result data. */
  call(to: string, data: string): string {
    const key = this.key(to);

    const token = this.tokens.get(key);
    if (token !== undefined) {
      if (token.notAToken === true) throw new Error('missing revert data');
      const fragment = ERC20.parseTransaction({ data });
      if (fragment !== null && fragment.name === 'balanceOf') {
        this.maybeFail('balanceOf');
        const [holder] = fragment.args.toArray() as [string];
        return ERC20.encodeFunctionResult('balanceOf', [this.tokenBalanceOf(to, holder)]);
      }
      if (fragment !== null && fragment.name === 'decimals') {
        return ERC20.encodeFunctionResult('decimals', [token.decimals]);
      }
      if (fragment !== null && fragment.name === 'symbol') {
        return ERC20.encodeFunctionResult('symbol', ['MOCK']);
      }
      if (fragment !== null && fragment.name === 'name') {
        return ERC20.encodeFunctionResult('name', ['Mock Token']);
      }
    }

    const nft = this.nfts.get(key);
    if (nft !== undefined) {
      const iface = nft.standard === 'erc721' ? ERC721 : ERC1155;
      const supports = ERC721.parseTransaction({ data });
      if (supports !== null && supports.name === 'supportsInterface') {
        const [id] = supports.args.toArray() as [string];
        const expected = nft.standard === 'erc721' ? INTERFACE_ID.erc721 : INTERFACE_ID.erc1155;
        return ERC721.encodeFunctionResult('supportsInterface', [
          id.toLowerCase() === expected.toLowerCase(),
        ]);
      }

      const fragment = iface.parseTransaction({ data });
      if (fragment !== null && fragment.name === 'ownerOf') {
        const [tokenId] = fragment.args.toArray() as [bigint];
        const owner = this.nftOwnerOf(to, tokenId.toString());
        if (owner === null) throw new Error('execution reverted: nonexistent token');
        return ERC721.encodeFunctionResult('ownerOf', [getAddress(owner)]);
      }
      if (fragment !== null && fragment.name === 'balanceOf' && nft.standard === 'erc1155') {
        const [holder, tokenId] = fragment.args.toArray() as [string, bigint];
        return ERC1155.encodeFunctionResult('balanceOf', [
          this.nft1155BalanceOf(to, tokenId.toString(), holder),
        ]);
      }
      if (fragment !== null && fragment.name === 'name') {
        return ERC721.encodeFunctionResult('name', ['Mock Collection']);
      }
    }

    throw new Error('missing revert data');
  }

  estimateGas(from: string, to: string, value: bigint, data: string): bigint {
    this.maybeFail('estimateGas');
    if (data === '0x' || data.length <= 2) {
      void from;
      void value;
      return 21_000n;
    }
    const call = this.decodeCall(to, data);
    if (call === null) throw new Error('missing revert data');
    switch (call.kind) {
      case 'erc20': {
        // Mirrors execution: the estimate depends on the destination's current
        // balance, so estimating against the wrong recipient yields the wrong
        // number — exactly as a real node would.
        const [recipient] = call.args as [string];
        return this.erc20TransferGas(to, recipient);
      }
      case 'erc721':
        return 85_000n;
      case 'erc1155':
        return 110_000n;
    }
  }

  feeData(): {
    maxFeePerGas: bigint | null;
    maxPriorityFeePerGas: bigint | null;
    gasPrice: bigint | null;
  } {
    this.maybeFail('getFeeData');
    if (this.eip1559) {
      return {
        maxFeePerGas: this.baseFee * 2n,
        maxPriorityFeePerGas: this.baseFee / 10n,
        // Nodes report `gasPrice` as `baseFee + tip`, not the base fee alone.
        // Arc Testnet does exactly this (21 gwei for a 20 gwei base), and
        // mirroring it here is what makes a quote that mistakes one for the
        // other observable in tests.
        gasPrice: this.baseFee + this.baseFee / 10n,
      };
    }
    return { maxFeePerGas: null, maxPriorityFeePerGas: null, gasPrice: this.baseFee };
  }

  /** Latest block header, as much of it as the pipeline reads. */
  block(): { baseFeePerGas: bigint | null; number: number } {
    return {
      baseFeePerGas: this.eip1559 ? this.baseFee : null,
      number: this.blockNumber,
    };
  }

  transactionCount(address: string): number {
    this.maybeFail('getTransactionCount');
    return this.nonces.get(this.key(address)) ?? 0;
  }

  balance(address: string): bigint {
    this.maybeFail('getBalance');
    return this.nativeBalanceOf(address);
  }

  /**
   * Receipt lookup.
   *
   * Returns `null` until `receiptDelayPolls` reads have happened for that hash,
   * which is how a real node behaves while a transaction is still pending.
   */
  receipt(
    hash: string,
  ): { blockNumber: number; status: number; gasUsed: bigint; hash: string } | null {
    this.maybeFail('getTransactionReceipt');
    const tx = this.sent.find((entry) => entry.hash === hash);
    if (tx === undefined) return null;

    const polls = (this.receiptPolls.get(hash) ?? 0) + 1;
    this.receiptPolls.set(hash, polls);
    if (polls <= this.receiptDelayPolls) return null;

    return { blockNumber: tx.blockNumber, status: tx.status, gasUsed: tx.gasUsed, hash };
  }

  currentBlock(): number {
    return this.blockNumber;
  }
}

/**
 * A provider object complete enough for a real ethers `Wallet` to sign and
 * broadcast through.
 *
 * Using a real `Wallet` matters: the burner path in `burner.service.ts`
 * constructs one from the decrypted key and asserts the derived address matches.
 * A stubbed signer would bypass exactly the code the tests need to cover, so the
 * harness implements the provider side instead and lets ethers do real signing.
 */
export function createMockProvider(mock: MockChain): MockProvider {
  const network = Network.from(mock.chain.id);

  const provider = {
    // --- reads ----------------------------------------------------------
    getNetwork: () => Promise.resolve(network),
    getBalance: (address: string) => Promise.resolve(mock.balance(address)),
    getFeeData: () => Promise.resolve(mock.feeData()),
    getBlock: () => Promise.resolve(mock.block()),
    getTransactionCount: (address: string) => Promise.resolve(mock.transactionCount(address)),
    getTransactionReceipt: (hash: string) => Promise.resolve(mock.receipt(hash)),
    getBlockNumber: () => Promise.resolve(mock.currentBlock()),
    estimateGas: (tx: { from?: string; to?: string; value?: bigint; data?: string }) =>
      Promise.resolve(
        mock.estimateGas(tx.from ?? ZERO, tx.to ?? ZERO, tx.value ?? 0n, tx.data ?? '0x'),
      ),
    call: (tx: { to?: string; data?: string }) =>
      Promise.resolve(mock.call(tx.to ?? ZERO, tx.data ?? '0x')),

    // ethers resolves a plain hex address without consulting the provider, so
    // this only has to exist for the ENS branch it never takes here.
    resolveName: (name: string) => Promise.resolve(name),

    // --- writes ---------------------------------------------------------
    /**
     * Decode the signed transaction and apply it.
     *
     * `Transaction.from` recovers the sender from the signature, so the mock
     * credits and debits the address that actually signed — the same check a
     * node performs.
     */
    broadcastTransaction: (signed: string) => {
      const parsed = Transaction.from(signed);
      const from = parsed.from;
      if (from === null) throw new Error('unsigned transaction rejected');

      const applied = mock.execute(from, parsed.to ?? ZERO, parsed.value, parsed.data ?? '0x', {
        gasLimit: parsed.gasLimit,
        maxFeePerGas: parsed.maxFeePerGas,
        // The tip has to reach the fee model, otherwise a type-2 transaction
        // would be charged as if the tip were zero and the refund would be
        // overstated.
        maxPriorityFeePerGas: parsed.maxPriorityFeePerGas,
        gasPrice: parsed.gasPrice,
      });
      return Promise.resolve({ hash: applied.hash, from: applied.from, to: applied.to });
    },

    destroy: () => undefined,
  };

  return provider as unknown as MockProvider;
}

/** Structural type for the harness provider; cast at the ethers boundary. */
export type MockProvider = Provider & {
  broadcastTransaction: (signed: string) => Promise<{ hash: string }>;
};

const ZERO = '0x0000000000000000000000000000000000000000';

/**
 * A `RpcPool` backed by a `MockChain`.
 *
 * The pool contract is implemented rather than the provider interface, because
 * that is the seam the pipeline depends on. Failures scripted through
 * `mock.failOn` surface here exactly as a live endpoint's would.
 */
export function createMockPool(mock: MockChain, provider: MockProvider): RpcPool {
  const endpoint: RpcEndpoint = { url: 'mock://primary', label: 'Mock' };

  const pool: RpcPool = {
    chain: mock.chain,
    provider: () => provider as unknown as ReturnType<RpcPool['provider']>,
    activeEndpoint: () => endpoint,
    run: async (_label, operation) =>
      operation(provider as unknown as Parameters<Parameters<RpcPool['run']>[1]>[0]),
    batchAll: async (_label, build) => {
      const promises: readonly Promise<unknown>[] = build(
        provider as unknown as Parameters<Parameters<RpcPool['batchAll']>[1]>[0],
      );
      return (await Promise.all(promises)) as never;
    },
    electFastestEndpoint: () => Promise.resolve(endpoint),
    destroy: () => undefined,
  };
  return pool;
}

/**
 * A signer for the user's main wallet.
 *
 * A real `Wallet` again, so the two transactions the user signs go through the
 * same signing and populate path a browser wallet would drive.
 */
export function createMainSigner(privateKey: string, provider: MockProvider): JsonRpcSigner {
  return new Wallet(privateKey, provider) as unknown as JsonRpcSigner;
}

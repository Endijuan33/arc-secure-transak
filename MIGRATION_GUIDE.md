# Migration Guide — v1 → v2

For developers who know the v1 codebase. Every v1 module has moved; this maps the
old surface onto the new one and explains the reasoning where a signature changed
rather than just relocating.

---

## Quick start

```bash
git pull
rm -rf node_modules pnpm-lock.yaml   # v2 uses npm
npm install
cp .env.example .env                 # set VITE_REOWN_PROJECT_ID
npm run dev
```

```bash
npm run verify   # typecheck + lint + test + build
```

**Package manager changed to npm.** `package-lock.json` is committed and CI runs
`npm ci`. Delete any leftover `pnpm-lock.yaml` and `.pnpm-store/`.

---

## File map

| v1                           | v2                                                                              | Note                                         |
| ---------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------- |
| `src/App.jsx` (488 lines)    | `src/App.tsx` (18) + `src/pages/TransferPage.tsx`                               | split                                        |
| `src/main.jsx`               | `src/main.tsx` + `src/components/ErrorBoundary.tsx`                             | boundary extracted                           |
| `src/utils/secureTransak.js` | `src/services/transak.service.ts`                                               | + `burner`, `gas`, `rpc` services            |
| `src/utils/tokenUtils.js`    | `src/services/token.service.ts` + `nft.service.ts`                              | split by standard                            |
| `src/utils/helpers.js`       | `src/services/addressBook.service.ts`, `history.service.ts`, `token.service.ts` | split by concern                             |
| `src/config/reown.js`        | `src/config/appkit.ts` + `src/config/chains.ts`                                 | chain registry extracted                     |
| `src/config/tokens.js`       | `src/config/chains.ts` → `knownTokens`                                          | now per-chain                                |
| `src/config/constants.js`    | `src/config/constants.ts`                                                       | keys renamed, see below                      |
| `src/hooks/useBalances.js`   | `src/hooks/useBalances.ts`                                                      | + `useRpcPool`                               |
| —                            | `src/security/*`                                                                | new: vault, memory, validation, rate limiter |
| —                            | `src/store/*`                                                                   | new: Zustand stores                          |
| —                            | `src/types/index.ts`                                                            | new: domain types                            |

Components without a v1 counterpart: `AboutPanel` (in-app documentation),
`ActivityLog` (structured log), `PipelineProgress`, `TransactionReceipt`,
`TransactionStatusPanel`, `BurnerRecoveryPanel`, `NotificationCenter`,
`ErrorBoundary`, `NftSelector`, `TransactionHistory`, `AmountInput`.

---

## API changes

### The pipeline entry point

**v1**

```js
import { executeAbsoluteSecureTransak } from './utils/secureTransak';

const hash = await executeAbsoluteSecureTransak({
  provider,
  signer,
  recipientAddress,
  amountUSDC, // misleading name: any token's base units
  tokenAddress, // null means native
  tokenDecimals,
  onStatusUpdate, // (string) => void
  signal,
});
```

**v2**

```ts
import { executeSecureTransak } from './services/transak.service';

const result = await executeSecureTransak({
  chain, // ChainConfig — no hardcoded chain id
  signer,
  walletProvider,
  request, // discriminated union, see below
  gasSpeed, // 'standard' | 'fast' | 'instant'
  signal,
  onEvent, // (PipelineEvent) => void — structured, not a string
});
// result: { hash, burnerAddress, blockNumber, gasUsed, refunded }
```

Three substantive differences, not just renaming:

**`request` is a discriminated union.** v1 encoded intent as
`tokenAddress === null`, which made NFTs unrepresentable and let a caller pass a
token address with native decimals. The union makes each asset kind carry exactly
the fields it needs:

```ts
type TransferRequest =
  | { kind: 'native'; recipient; amount; decimals; symbol }
  | { kind: 'erc20'; recipient; amount; decimals; symbol; token }
  | { kind: 'erc721'; recipient; contract; tokenId; symbol }
  | { kind: 'erc1155'; recipient; contract; tokenId; amount; symbol };
```

**`onEvent` replaces `onStatusUpdate`.** v1 emitted display strings, so the UI
could not tell _which_ step was running and had to string-match to build any
structure. v2 emits `{ step, phase, detail }` where `step` is one of the ten
`PipelineStepId` values and `phase` is `start | progress | done | skipped`. The
detail string is still there for display.

**The return value is an object.** v1 returned a bare hash, so block number, gas
used, and whether the sweep succeeded were unavailable to the caller.

### The activity log is structured

`transferStore.log` changed from `readonly string[]` to
`readonly ActivityLogEntry[]`:

```ts
interface ActivityLogEntry {
  readonly id: number; // per-run sequence
  readonly at: number; // epoch ms
  readonly elapsedMs: number; // offset from the start of this run
  readonly step: PipelineStepId;
  readonly stepLabel: string;
  readonly phase: 'start' | 'progress' | 'done' | 'skipped' | 'failed';
  readonly level: NotificationLevel;
  readonly message: string;
}
```

If you were rendering `log.join('\n')`, render the entries instead — or reuse
`ActivityLog`, which handles filtering and the copy-to-clipboard format.

Step metadata also moved into one place: `PIPELINE_DEFINITIONS` now carries a
`summary` (one sentence per step) and a `signature` flag (true for the two steps
that prompt the wallet). Read them via `stepDefinition(id)` / `stepLabel(id)`
rather than duplicating the prose.

### Error handling

v1 threw `Error` with a message from `parseUserFriendlyError`. v2 uses typed
errors, so callers can branch on kind:

```ts
try {
  await executeSecureTransak(input);
} catch (error: unknown) {
  if (error instanceof AbortedError) {
    /* user pulled the kill switch */
  }
  if (error instanceof ValidationError) {
    /* show error.message verbatim */
  }
  if (error instanceof RecoveryFailure) {
    // Assets are stranded. error.sessionHandle is STILL LIVE — the caller now
    // owns it and must call destroySession() when done.
    // See the ownership note below.
  }
  const message = toUserMessage(error); // always safe, never throws
}
```

`RecoveryFailure` ownership matters: the pipeline deliberately does _not_ destroy
the session, because the handle is the only remaining route to those funds. If you
handle this error, you must eventually call `destroySession(error.sessionHandle)`
— `transferStore.dismissStranded()` is the reference implementation.

**Do not destroy a session on the assumption that a sweep worked.** The pipeline
gates `destroyBurnerSession` on `recoverFromBurner` reporting `nativeRecovered`,
which is derived from re-reading the burner's balance from chain — not from the
sweep call having returned. An early version inferred it and permanently destroyed
a key over a live balance; see
[§10.4 of the upgrade report](./UPGRADE_REPORT.md#104-a-regression-of-mine-destroyed-a-key-over-a-live-balance).

### Burner key access

v1 read a module variable. v2 requires a scoped callback:

```ts
// v1
const wallet = new ethers.Wallet(sessionPrivateKey, provider);

// v2
await withBurnerSigner(session, provider, async (wallet) => {
  return wallet.sendTransaction(tx);
});
// The key buffer is zeroed before this returns.
```

Do not retain `wallet` past the callback. The plaintext is wiped in a `finally`
block, so a retained reference is to a wallet whose key material has been
destroyed.

### Validation

```ts
// v1
if (!isAddress(recipient)) {
  toast.error('Invalid destination address!');
  return;
}

// v2
const check = validateRecipient(recipient, { sender: myAddress });
if (!check.ok) {
  notify.error('Invalid recipient', check.error);
  return;
}
const checksummed = check.value; // narrowed by the discriminant
```

Validators never throw. The result type forces the rejection branch to be handled.

### History

localStorage → IndexedDB, with cursor pagination:

```ts
// v1
const all = loadTransactions(); // entire array, sync
const page = all.slice((p - 1) * SIZE, p * SIZE); // numbered pages

// v2
const page = await readHistoryPage(chainId, cursor);
// { items, nextCursor, total } — pass nextCursor back for the next page
```

**Numbered pages are gone.** A cursor-addressed source has no offset to seek to,
so the UI offers "load more". In exchange, reads are O(page size) instead of
O(history size) and cursors stay stable when a new transaction is inserted.

The v1 localStorage history migrates automatically on first load
(`migrateLegacyHistory`, idempotent, clears the old key only after a successful
import). Records get `chainId` and `sender` backfilled from the current session,
since v1 stored neither.

### Address book

Still localStorage, but the key changed from `arc_address_book` to
`arc.addressBook.v2` and entries gained `chainId` and `createdAt`. The old key is
read once and removed on the next save, so no manual migration is needed.

### Renamed constants

| v1                    | v2                                         |
| --------------------- | ------------------------------------------ |
| `TX_HISTORY_KEY`      | (gone — IndexedDB)                         |
| `BALANCE_CACHE_KEY`   | (gone — in-memory cache)                   |
| `ADDRESS_BOOK_KEY`    | `STORAGE_KEYS.addressBook`                 |
| `CACHE_TTL`           | `BALANCE_CACHE_TTL_MS`                     |
| `SAFETY_BUFFER`       | (gone — `computeBurnerFunding` derives it) |
| `MIN_BALANCE_FOR_GAS` | (gone — same)                              |
| `GAS_MULTIPLIER`      | `GAS_SPEED_MULTIPLIER` (per speed)         |

New in v2, both governing the sweep's fee ceiling:
`BASE_FEE_HEADROOM_PERCENT` / `BASE_FEE_HEADROOM_DIVISOR` (1125 / 1000 — one block
of base-fee growth, the maximum EIP-1559 allows) and `FUNDING_BUFFER_PERCENT` (25,
applied proportionally with the chain's `gasSafetyBufferWei` as a floor).

---

## Adding a chain

Append one entry to `SUPPORTED_CHAINS` in `src/config/chains.ts`:

```ts
const BASE_SEPOLIA: ChainConfig = {
  id: 84532,
  name: 'Base Sepolia',
  network: 'base-sepolia',
  testnet: true,
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcEndpoints: [{ url: 'https://sepolia.base.org', label: 'Base' }],
  explorer: {
    name: 'Basescan',
    url: 'https://sepolia.basescan.org',
    apiBase: null, // null disables explorer reads → NFT tab hidden,
    // token balances fall back to knownTokens over RPC
  },
  knownTokens: [],
  fallbackGasPriceWei: 1_000_000_000n,
  gasSafetyBufferWei: 1_000_000_000_000_000n,
  supportsEip1559: true,
};

export const SUPPORTED_CHAINS = [ARC_TESTNET, BASE_SEPOLIA];
```

Nothing else changes. The chain selector appears automatically once more than one
chain is registered, and the RPC pool, gas estimator, history store, and explorer
links all read from the config.

`apiBase: null` is the meaningful decision: without a Blockscout-compatible API,
NFT discovery is impossible from a browser (it would require scanning `Transfer`
logs from genesis), so the NFT tab hides itself rather than showing a
misleading empty list.

---

## Adding a token

Add to that chain's `knownTokens`. This list is the **RPC fallback** — when the
explorer API works, it returns every token the wallet holds and `knownTokens` only
supplies curated logos.

---

## Writing tests

```bash
npm test              # watch
npm run test:run      # once
npm run test:coverage
```

Two environment facts that will otherwise cost you time:

**The environment is `node`, not `jsdom`.** Under jsdom, ethers rejects its own
output with `invalid BytesLike value`, because vitest's jsdom runs in a separate
V8 realm where Node's `Buffer` is not `instanceof` the realm's `Uint8Array`. If
you add component render tests, they need their own config with
`environment: 'jsdom'` and must avoid constructing ethers wallets.

**`localStorage` is shimmed** in `tests/setup.ts`. Node 26 defines its own
experimental `localStorage` getter that resolves to `undefined` and shadows any
later implementation.

### Using the mock chain

```ts
const mock = new MockChain({
  chain: DEFAULT_CHAIN,
  nativeBalances: { [MAIN_ADDRESS]: parseUnits('1', 18) },
  tokens: [{ address: TOKEN, decimals: 6, balances: { [MAIN_ADDRESS]: 1_000_000n } }],
});

const provider = createMockProvider(mock);
const signer = createMainSigner(MAIN_KEY, provider);

// Fail the second `transfer` call — the burner's outbound leg:
mock.failOn({ on: 'transfer', occurrence: 2, error: new Error('execution reverted') });

// Withhold receipts for two polls, simulating mining latency:
mock.receiptDelayPolls = 2;

await executeSecureTransak({
  chain: DEFAULT_CHAIN,
  signer,
  walletProvider: provider,
  request,
  gasSpeed: 'standard',
  signal: null,
  onEvent: () => undefined,
  poolFactory: () => createMockPool(mock, provider),
  receiptPollIntervalMs: 10, // production is 5000
});
```

Signing is real — both wallets are genuine ethers `Wallet` instances and
`broadcastTransaction` recovers the sender from the signature. Assert on outcomes
(`mock.tokenBalanceOf`, `mock.sentFrom`) rather than on call sequences.

**The mock is stricter than it looks, and deliberately so.** Four production bugs
escaped the suite because the harness was more forgiving than a node, so it now
models:

- **Per-destination ERC-20 gas.** `COLD_ERC20_TRANSFER_GAS` (60 000) for a
  zero-balance destination, `WARM_ERC20_TRANSFER_GAS` (45 000) otherwise, and it
  throws `OutOfGasError` when the supplied limit is short. Seed a destination with
  `seedTokenBalance()` to make it warm.
- **Real fee charging.** `baseFee + tip`, capped at `maxFeePerGas` — not the
  ceiling. `feeData()` reports `gasPrice = baseFee + tip` and `block()` exposes
  `baseFeePerGas`, matching what a node actually returns.
- **The EIP-1559 admission rule.** A transaction is rejected unless
  `value + gasLimit × maxFeePerGas ≤ balance`. This is what makes under-reserved
  sweeps fail in tests instead of only in production.

If you add to the harness, treat any place it is more permissive than a node as a
latent bug rather than a convenience.

---

## Gotchas

**`exactOptionalPropertyTypes` is on.** `{ a?: string }` does not accept
`{ a: undefined }`. Use conditional spread:

```ts
const options = { ...(value !== undefined ? { key: value } : {}) };
```

**`noUncheckedIndexedAccess` is on.** `array[0]` is `T | undefined`. Use `.at()`,
optional chaining, or an explicit guard.

**Never call `contract.method()` directly.** It goes through an index signature,
so it is `T | undefined` and untyped. Use the wrappers in
`src/services/contract.ts` (`callRead`, `callWrite`, `callEstimateGas`).

**Do not put `setState` in an effect body.** `eslint-plugin-react-hooks` v7 flags
it as `react-hooks/set-state-in-effect`. Derive during render instead — the
pattern used throughout `hooks/` is to store a key or tag the stored value with
its owner, then filter during render. See `useBalances` (snapshot carries `owner`)
and `useGas` (quote carries its request `key`).

**`connect()` returns a new instance.** In ethers v6,
`wallet.connect(provider)` does not mutate. v1 had several no-op calls that
silently left the wallet on a failed endpoint.

**Estimate gas against the address the transaction is actually sent to.** Each leg
of the pipeline has a different destination, and an ERC-20 `transfer` to a
zero-balance address costs roughly 15 000 gas more than to one that already holds
the token (cold vs warm SSTORE). Reusing one estimate across legs reverts on-chain.
`withDestination(request, address)` exists for this; see
[§10.2](./UPGRADE_REPORT.md#102-the-forward-leg-was-estimated-against-the-final-recipient).

**Reserve the fee ceiling, not the expected fee.** A node admits a transaction only
when `value + gasLimit × maxFeePerGas ≤ balance`, and the EIP-1559 refund arrives
_after_ inclusion, so it cannot fund the transaction that earns it. To reduce
leftover dust, lower the sweep's own `maxFeePerGas` (`sweepFeeQuote()`) rather than
the reserve. Getting this backwards strands funds — see
[§10.3](./UPGRADE_REPORT.md#103-sweeps-were-priced-at-the-ceiling-leaving-11-more-dust-than-necessary).

**Leave `enableEIP6963: true` alone.** AppKit defaults it to `false`, which hides
the injected wallet entirely and forces every connection through the WalletConnect
relay. On mobile that deeplinks the dApp onto a non-secure origin, where
`crypto.subtle` is withheld and the vault cannot operate.

**Use `notify`, not `toast`.** `react-hot-toast` is confined to
`NotificationCenter`. Everything else goes through the store, which is what makes
notifications assertable in tests.

---

## Rollback

v1 is at commit `cff8053`:

```bash
git checkout cff8053 -- src/ index.html package.json vite.config.js
rm -rf node_modules package-lock.json
npm install --legacy-peer-deps   # or pnpm install
```

The v2 IndexedDB store and the `arc.addressBook.v2` key are additive — v1 never
reads them — so rolling back loses the v2 history but leaves v1's data intact if
it was never migrated. Once `migrateLegacyHistory` has run, the v1 localStorage
history is gone; export it first if you need it.

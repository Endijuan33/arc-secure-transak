# Upgrade Report — v1.0.0 → v2.0.0

This document records what changed in the v2 rewrite, why each change was made,
and what was deliberately left alone. It is written for someone who knows the v1
codebase and needs to understand the delta.

**Verification status:** `npm run typecheck`, `npm run lint`,
`npm run format:check`, `npm run test:run` (325 tests), and `vite build` all pass
locally on Node 26 / Termux ARM64. The app was additionally exercised in a real
browser against Arc Testnet across nine pipeline runs, which uncovered four
defects the mock chain could not — see [Browser and on-chain
verification](#10-browser-and-on-chain-verification).

---

## 1. Security

### 1.1 The burner private key is no longer a module-level variable

**v1.** `src/utils/secureTransak.js` held the key in two module-scope
mutable bindings:

```js
let sessionPrivateKey = null;
let sessionBurnerAddress = null;
```

Any code in the module could read them, they persisted between calls until
explicitly reassigned, and `null`-ing a `string` does not remove the original
value from the heap.

**v2.** `src/security/keyVault.ts` holds key material in a `WeakMap` keyed by an
opaque `SessionHandle`:

- The handle carries only `sessionId` and `createdAt` — no key material, so it is
  safe to pass around and to store in React state.
- `WeakMap` is not enumerable, so no code path can iterate live sessions and
  harvest keys.
- Dropping the handle makes the record collectable even if `destroySession` was
  never called.

### 1.2 The key is encrypted at rest in memory (AES-256-GCM)

The key is sealed with a per-session, **non-extractable** `CryptoKey`
(`generateKey(..., false, ...)`), so the wrapping key's bytes never exist in the
JS heap. Plaintext exists only inside a `withKey` callback:

```ts
await withKey(handle, (keyBytes) => {
  /* keyBytes is live here, and zeroed the moment this returns */
});
```

After every unseal the record is re-sealed under a **fresh 12-byte IV**, so
identical plaintext never produces repeating ciphertext across a session.

### 1.3 Zeroization is enforced in `finally`

`src/security/memory.ts` overwrites buffers with random bytes _then_ zeros, so a
post-mortem heap dump cannot distinguish a wiped buffer from an unused one. Every
call site wipes in a `finally` block, which means a caller throwing mid-operation
cannot leak a live buffer. Covered by
`tests/unit/keyVault.test.ts` → "wipes the plaintext even when the callback
throws".

The key exists as an immutable `string` at exactly one point — the ethers.js
`new Wallet(hex)` boundary in `burner.service.ts`. That is unavoidable with
ethers; what v2 guarantees is that the lifetime is one operation long.

### 1.4 The console key leak is closed

**v1** printed the burner private key to the status log _and_ to `console.error`
on every recovery failure:

```js
onStatusUpdate(`🔑 BACKUP PRIVATE KEY (SAVE THIS NOW): ${sessionPrivateKey}`);
console.error('BURNER PRIVATE KEY BACKUP:', sessionPrivateKey);
```

That exposed the key to anything reading the console, to any error-reporting
integration, and to any screen recording of the page.

**v2** never emits key material automatically. When recovery genuinely fails, the
pipeline throws `RecoveryFailure` carrying a _live vault handle_, and the UI
offers a two-stage gate: expand the danger section, tick an explicit
acknowledgement, then press reveal. The revealed value is auto-wiped after 60
seconds, on unmount, and when the session is destroyed. It is never logged,
persisted, or transmitted.

Verified by `tests/integration/transak.test.ts` → "never emits the private key in
any event detail" and "does not leak the key in the RecoveryFailure message".

### 1.5 Rate limiting

`src/security/rateLimiter.ts` applies a sliding-window cap (5 per 60 s) and a
minimum cooldown (3 s), enforced in `transferStore.execute` _before_ any wallet
interaction — so a throttled attempt costs the user nothing.

This is an accident guard (double-submit, stuck key, runaway retry), not a
security boundary: a user can reload the page. Real enforcement is on-chain via
nonces. The clock is injectable, so the tests are deterministic.

### 1.6 Strict input validation

`src/security/validation.ts` replaces v1's `ethers.isAddress` call and inline
regex. Every function returns a discriminated result rather than throwing, so the
type system forces callers to handle rejection.

| Check                                                       | Rationale                                                                                                        |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `0x` prefix required                                        | ethers' `isAddress` accepts a bare 40-char hex string, so a truncated paste looks valid                          |
| EIP-55 checksum enforced                                    | a case-mangled address is rejected rather than silently normalised                                               |
| Blocklist                                                   | zero address, `0x…dEaD`, ETH2 deposit, CREATE2 deployer, ERC-1820 registry — assets sent there are unrecoverable |
| Self-send rejected                                          | wastes gas                                                                                                       |
| Burner-as-recipient rejected                                | would strand assets in a wallet about to be destroyed                                                            |
| Amount: no exponent / comma / negative / `NaN` / `Infinity` | `parseUnits` either throws or silently surprises on these                                                        |
| Fractional digits ≤ token decimals                          | prevents silent truncation                                                                                       |
| Balance ceiling                                             | rejects before the wallet prompt                                                                                 |
| Tag: control characters rejected before whitespace collapse | `\n` is whitespace, so collapsing first would accept it                                                          |

71 test cases in `tests/unit/validation.test.ts`.

### 1.7 Untrusted-input hardening

Explorer API responses (token balances, NFT lists) arrive as `unknown` and every
field passes an explicit guard before entering a typed shape. A malformed entry
is dropped, not allowed to poison the list. NFT metadata URIs are restricted to
`https:`, `ipfs:`, and `data:image/`, so a hostile collection cannot inject
`javascript:` into an `<img src>`.

---

## 2. TypeScript migration

Every `.js` / `.jsx` file was converted. `tsconfig.json` enables `strict: true`
plus the flags strict mode does _not_ include:

- `exactOptionalPropertyTypes` — `{ a?: string }` no longer accepts
  `{ a: undefined }`
- `noUncheckedIndexedAccess` — `array[0]` is `T | undefined`
- `noImplicitReturns`, `noFallthroughCasesInSwitch`
- `noUnusedLocals`, `noUnusedParameters`
- `useUnknownInCatchVariables`

There is **no `any`** in `src/`. ESLint enforces this with
`@typescript-eslint/no-explicit-any` plus the five `no-unsafe-*` rules, all at
`error`. Untyped boundaries use `unknown` and narrow explicitly.

Two `as unknown as` casts remain, both isolated and commented:

1. `src/config/appkit.ts` — AppKit types `adapters` as `ChainAdapter[]` while
   `EthersAdapter` exposes `namespace?: ChainNamespace | undefined`. Under
   `exactOptionalPropertyTypes` those are distinct types. Widening at this one
   boundary is preferable to relaxing the flag project-wide.
2. `tests/helpers/mockChain.ts` — the harness implements the provider surface the
   pipeline uses, cast at the ethers boundary.

`src/services/contract.ts` exists because `contract.someMethod` goes through an
index signature — `T | undefined` under `noUncheckedIndexedAccess`, and untyped
under `no-unsafe-call`. `getFunction` is the checked equivalent, and the wrappers
give the call and its `estimateGas` companion concrete signatures.

---

## 3. Architecture

### 3.1 Layering

```
src/
├── security/    memory, keyVault, validation, rateLimiter   (no imports from above)
├── config/      chains, constants, abi, appkit
├── services/    rpc, gas, burner, token, nft, transak, history, addressBook, errors
├── store/       sessionStore, transferStore, notificationStore, pipeline
├── hooks/       useWallet, useBalances, useGas, useTransak, useBurnerWallet, …
├── components/  presentational only
└── pages/       TransferPage
```

Dependencies point strictly downward. `services/` has no React import;
`components/` has no ethers import.

### 3.2 `App.jsx` (488 lines) split up

v1's `App.jsx` mixed wallet connection, balance fetching, form state, validation,
transaction execution, address-book CRUD, pagination maths, and ~200 lines of
inline style objects.

v2's `App.tsx` is 18 lines. The work is distributed across 16 components, 10
hooks, and 3 stores, each with a single responsibility.

### 3.3 Zustand, not Context

Chosen because the pipeline writes state from _outside_ the React tree — from a
service callback, mid-`await`, many times per run. A Context value would
re-render the provider and cascade through the whole tree on every pipeline
event. Zustand's selector subscriptions mean each component re-renders only when
the slice it reads changes.

### 3.4 Styling

~200 lines of inline style objects became CSS custom properties on
`[data-theme]`. Switching theme is one attribute write on `<html>` — no component
re-render, no flash of restyled content. This is also what makes the light theme
possible without touching component code.

---

## 4. Bug fixes

These are behavioural defects found in v1 while porting, not stylistic changes.

### 4.1 Burner funding did not budget for its own sweep

**v1** computed `estimatedGasCost + safetyBuffer` and funded that. The burner then
had to pay for the outbound transfer _and_ the sweep back to the main wallet out
of the same amount. When the sweep could not be afforded, the leftover was
stranded.

**v2** `computeBurnerFunding` explicitly adds `21000 × effectiveGasPrice` for the
sweep plus the chain's safety buffer. Under-funding here is the single most likely
way to strand assets, so it is budgeted for rather than hoped for. Asserted in
`tests/unit/gas.test.ts` → "always exceeds the transfer cost alone".

### 4.2 `burnerWallet.connect()` result was discarded

```js
burnerWallet.connect(rpcProviderRef.provider); // return value dropped
```

`connect()` returns a **new** wallet instance in ethers v6; it does not mutate the
receiver. Every one of these calls was a no-op, so after an RPC rotation the
burner kept using the failed endpoint. v2 constructs the wallet inside `withKey`
against the current provider, so the question cannot arise.

### 4.3 RPC failover never rotated

```js
let currentRpcIndex = 0; // reset on every call
const nextIndex = (currentRpcIndex + 1) % rpcList.length;
```

`currentRpcIndex` was a local inside `withAutoRetry`, re-initialised to `0` per
invocation. Every "rotation" therefore moved from index 0 to index 1, repeatedly.
With five endpoints configured, three were unreachable in practice.

v2's `createRpcPool` holds the index in a closure that lives for the pool's
lifetime, so rotation walks the full list. It also adds exponential backoff with
full jitter (v1 used linear `4000 × attempt`).

### 4.4 ERC-20 gas was estimated against the wrong recipient

```js
const estimate = await tokenContract.transfer.estimateGas(
  burnerWallet.address, // ← estimating a transfer to the burner
  amountUSDC,
);
```

The estimate measured a transfer to the burner, then that figure was used for the
final transfer to the actual recipient. A recipient contract with a
`_beforeTokenTransfer` hook or first-write storage cost consumes more, so the
transaction could run out of gas.

v2 simulates the exact call being broadcast, twice: once from the main wallet for
the advisory quote, and again from the burner immediately before dispatch, taking
whichever limit is higher.

### 4.5 Funding used the ERC-20 gas limit for a plain transfer

`buildTxConfig(burnerWallet.address, totalFundingNeeded, estimatedGasLimit, …)`
passed the ERC-20 limit (~150 000) to a 21 000-gas value transfer. Not
incorrect — unused gas is refunded — but it inflated the balance check and could
cause a spurious "insufficient funds" rejection. v2 uses `21000n`.

### 4.6 The receipt poller could hang forever

`safeWaitForTransaction` swallowed every error including `MANUAL_ABORT` on the
first iteration, so an abort during receipt polling was ignored for up to 200
seconds (40 × 5 s). v2 re-checks the signal at the top of each iteration and
rethrows `AbortedError` immediately.

### 4.7 A reverted transaction was reported as success

v1 returned as soon as `receipt.blockNumber !== null`, without checking
`receipt.status`. A transaction that was mined but reverted was reported as
successful and written to history as `status: 'success'`. v2 throws
`TerminalError` on `status === 0`.

### 4.8 Recovery honoured the abort signal

v1's recovery block passed the same aborted signal into its retry helper, so a
user-initiated abort could cancel the recovery meant to return their funds. v2's
`recoverFromBurner` deliberately uses `signal: null` — honouring the abort here
would strand the assets.

### 4.9 The React key was the array index

```jsx
{paginatedHistory.map((tx, idx) => <div key={idx} …>)}
```

Index keys break when the list is prepended to, which is exactly what
`saveTransaction` did. Expanding a row then adding a transaction showed the wrong
row's details. v2 keys on the record's stable `id`.

### 4.10 MAX on the native asset used a hardcoded buffer

v1 subtracted a constant `SAFETY_BUFFER = 0.001`, unrelated to actual gas cost.
Too small at high fees (transaction fails), too large at low fees (dust left
behind). v2 subtracts the live `computeBurnerFunding` figure.

---

## 5. Error handling and UX

- **Error boundary** — `src/components/ErrorBoundary.tsx` offers subtree remount
  (`resetKey`) before a full reload. Errors go to `console.error` only; no remote
  reporting, because a stack trace here can contain addresses and amounts.
- **Structured notifications** — a `notificationStore` with
  `success | error | warning | info`, capped at 5 entries so a retry storm cannot
  grow the array without bound. `react-hot-toast` is confined to a single bridge
  component.
- **Granular progress** — all ten stages are individually tracked
  (`idle | active | done | failed | skipped`) with per-step detail and a progress
  bar. Marking step N done settles any earlier `active` step, so a dropped event
  cannot leave a stale spinner.
- **Status tracking** — a `pending` history row is written _before_ the pipeline
  starts, so an interrupted run (closed tab, lost power) still leaves a trace to
  reconcile against the explorer.
- **Error messages** — `extractErrorText` walks the whole error object graph
  (depth- and cycle-bounded) rather than guessing at `error.message`. Provider
  errors nest the useful signal at varying depths.

### 5.1 The interface explains the mechanism

A tool that asks a user to route funds through a key it generates cannot leave the
explanation in a README. The v1 UI was a form plus a scrolling text log; v2 splits
the page into three tabs and states the guarantee in the interface itself.

- **`AboutPanel`** (lazy-loaded) documents the threat model, the guarantee, how the
  key is handled, all ten stages, what happens on failure, the cost — and, in a
  section of its own, **what the tool does not protect against**: a mistyped
  address, a token contract that lies, losing the tab mid-transfer, a compromised
  device. That section is not a disclaimer. A user who believes this eliminates all
  risk will take risks they otherwise would not.
- **`ActivityLog`** replaced the raw string log. Entries are structured
  (`ActivityLogEntry` with step, phase, severity, elapsed offset) and rendered as a
  timeline with relative timestamps. Three filters — Milestones, Detailed,
  Issues — default to Milestones, so the normal case is a short list of completed
  stages rather than a wall of progress chatter. A copy button produces plain text
  for a bug report.
- **`PipelineProgress`** is a vertical timeline that renders _before_ a run as a
  preview, built from each step's `summary`, with the two steps requiring a wallet
  signature tagged as such. The approval count is the thing that makes an
  unexpected third prompt recognisable, so it is stated up front and repeated in
  the footer.
- **`TransactionReceipt`** presents the outcome as a labelled record — recipient,
  block, gas used, unused gas returned, burner address, transaction hash — each
  explorer-linked. It reads from the _validated request_, not the live form fields,
  so editing the form after a transfer cannot silently rewrite the receipt.
- **Secure-context badge and banner** — see §10.1.

`PIPELINE_DEFINITIONS` now carries a one-sentence `summary` and a `signature` flag
per step, so the About panel, the timeline preview, and the log labels all derive
from one source rather than three copies of the same prose.

---

## 6. Performance

- **Code splitting** — `NftSelector`, `TransactionHistory`, and `AboutPanel` are
  `React.lazy`. Vendor chunks split react / ethers / appkit.
- **Batched RPC** — one shared `RpcPool` per chain with `batchMaxCount: 20`.
  ethers coalesces same-tick calls into one JSON-RPC array payload; issuing reads
  together is what turns N round trips into one. A per-hook provider would defeat
  this.
- **Latency election** — `electFastestEndpoint` probes all endpoints once per
  session and promotes the fastest, so the first read is not gated on the slowest
  node.
- **Debounced input** — `useDebouncedValue` keeps the field un-debounced (typing
  never lags) while the expensive consumer sees only the settled value.
- **IndexedDB history** — replaces localStorage, which was synchronous
  (main-thread blocking on every write), a few MB shared with the whole origin,
  and unindexed, so paginating meant parsing all history on each render.
- **Polling paused during a transfer** — mid-pipeline balances are transient
  (funds sit in the burner between steps); refetching wastes quota and briefly
  shows a figure about to change.
- **`staticNetwork`** — avoids an `eth_chainId` round trip before every call.

### Cursor pagination

IndexedDB's auto-incrementing key is monotonic, so "the page after id N" is a
bounded range query — O(page size) rather than O(history size). Cursors are
therefore stable under concurrent inserts: a new transaction never shifts a page
the user has already seen. Asserted in `tests/unit/history.test.ts` → "keeps
earlier pages stable when a new record is inserted".

The tradeoff is that numbered pages are gone: a cursor-addressed source has no
offset to seek to, so the UI offers "load more". This is a deliberate exchange of
random access for read cost and stability.

---

## 7. New features

- **Multi-chain registry** — `src/config/chains.ts` is the only file to edit to
  add a network. No chain id is hardcoded anywhere else. The chain selector only
  renders when more than one chain is registered.
- **NFT transfers** — ERC-721 and ERC-1155. The standard is confirmed via ERC-165
  `supportsInterface` before dispatch, because the transfer signature differs and
  calling the wrong one either reverts or matches a different method.
- **Gas simulation** — real `estimateGas` against the target contract, with a
  documented per-standard fallback and a `simulated: boolean` flag so the UI can
  say when a figure is approximate.
- **Dark / light theme** — CSS custom properties, following the OS preference on
  first visit.
- **Gas speed selector** — standard / fast / instant, with the priority tip
  clamped so it can never exceed the max fee (a combination some nodes reject).
- **Address-book export / import** — existing entries win on address collision,
  so importing a stale backup cannot relabel a bookmark since renamed.

---

## 8. Testing

325 tests across 10 files.

| File                          | Tests | Covers                                              |
| ----------------------------- | ----- | --------------------------------------------------- |
| `unit/validation.test.ts`     | 71    | every validator, including hostile input            |
| `unit/errors.test.ts`         | 57    | classification, cyclic graphs, message mapping      |
| `unit/addressBook.test.ts`    | 30    | CRUD, persistence, malformed storage, import/export |
| `unit/history.test.ts`        | 29    | cursor pagination, chain isolation, v1 migration    |
| `unit/gas.test.ts`            | 28    | fee quoting, tip clamping, funding and sweep maths  |
| `unit/pipeline.test.ts`       | 22    | step reducer, progress, stale-spinner recovery      |
| `unit/keyVault.test.ts`       | 18    | seal/unseal, zeroization, isolation, no-storage     |
| `unit/memory.test.ts`         | 18    | zeroization, hex round-trip, detached buffers       |
| `unit/rateLimiter.test.ts`    | 13    | sliding window, cooldown, injected clock            |
| `integration/transak.test.ts` | 39    | the full ten-step pipeline                          |

### Test environment notes

Both are non-obvious and cost real debugging time, so they are recorded here.

**`environment: 'node'`, not `jsdom`.** vitest's jsdom environment runs in a
separate V8 realm, so Node's `Buffer` — what ethers' Node build returns from its
hashing primitives — is not `instanceof` the jsdom realm's `Uint8Array`. ethers
then rejects its own output with `invalid BytesLike value`, making
`Wallet.createRandom()` unusable. Nothing in the suite renders components, so a
DOM adds nothing.

**Node 26 shadows `localStorage`.** Node defines its own experimental
`localStorage` getter on `globalThis` that resolves to `undefined` unless started
with `--localstorage-file`. Being an own property, it shadows any implementation
supplied later. `tests/setup.ts` installs a spec-shaped in-memory `Storage` over
it.

### The mock chain

`tests/helpers/mockChain.ts` is an in-process EVM substitute. It models balances,
nonces, gas accounting, fee deduction, receipts appearing only after mining, and
per-method failure injection.

Crucially, **signing is real**: both the user's wallet and the burner are genuine
ethers `Wallet` instances, and `broadcastTransaction` recovers the sender from the
signature. So the vault decrypt → construct `Wallet` → derive-and-verify
address → sign → broadcast chain is exercised end to end. A stubbed signer would
bypass exactly the code that most needs coverage.

This is what makes otherwise impractical scenarios testable: an RPC that
rate-limits on the third call, a transfer that reverts only when sent from the
burner, a receipt that never arrives, a recovery that fails twice.

Not modelled: real EVM bytecode execution and block production.

### What the mock chain got wrong

Every browser-discovered defect in section 10 traced back to a simplification
here, and each was closed by making the harness stricter. Recording them together
is the point: a mock that is _convenient_ silently narrows what the suite can
prove.

| Simplification                                    | Bug it hid                                |
| ------------------------------------------------- | ----------------------------------------- |
| Flat 55 000 gas for every ERC-20 `transfer`       | cold vs warm SSTORE (§10.2)               |
| Charged fees at `maxFeePerGas`                    | over-reserved sweeps leaving dust (§10.3) |
| `eth_gasPrice` reported as the base fee           | fee derivation off by the priority tip    |
| No admission check before accepting a transaction | rejected sweep, stranded balance (§10.4)  |

The harness now models per-destination ERC-20 gas
(`WARM_ERC20_TRANSFER_GAS` / `COLD_ERC20_TRANSFER_GAS`), charges
`baseFee + tip` capped at `maxFee`, exposes `baseFeePerGas` on the block header,
and enforces `value + gasLimit × maxFeePerGas ≤ balance` before admitting a
transaction. Further simplifications may still be hiding defects; the pattern to
distrust is any place the harness is more forgiving than a node.

---

## 9. Known limitations

**A lying token contract is not detected.** A `transfer` that returns `true`
without moving anything produces a successful receipt, and the pipeline reports
success. Detecting it needs a post-transfer `balanceOf` on the recipient — an
extra RPC read on every transfer. Pinned by
`integration/transak.test.ts` → "documents that a lying token contract still
reports success", so the decision is visible rather than forgotten.

**The burner model has an irreducible window.** Between funding and the final
dispatch, assets are held by an address whose key exists only in this tab's
memory. If the tab dies there, recovery cannot run and the assets are reachable
only via the revealed key — which is why the reveal path still exists.

**`localStorage` still holds the address book.** The data is small, bounded, and
non-secret; synchronous access is convenient for first render.

**Rate limiting is per-tab and in-memory.** A reload resets it. It guards against
accidents, not adversaries.

**Each burner keeps a small residual balance.** Measured at 0.0000525 native on
Arc Testnet, and structural rather than an estimation error — see §10.3. It is one
block of base-fee headroom on a 21 000-gas sweep. Removing it would mean pricing
the sweep at exactly the current base fee, and any rise between quoting and
inclusion would get the sweep rejected — which is how §10.4 destroyed funds.

---

## 10. Browser and on-chain verification

Nine pipeline runs were executed from a real browser against Arc Testnet, with a
live wallet, real signatures, and real fees. Four defects surfaced that the test
suite could not: all four lived in the gap between how the mock chain behaved and
how a node behaves.

This section exists because those four are the most instructive part of the
upgrade. Three of them were in code that 314 passing tests had already covered.

### 10.1 AppKit never offered the injected wallet

**Symptom.** Repeated relay failures in the browser console:

```
core: Couldn't establish socket connection to the relay server:
wss://relay.walletconnect.org
```

followed by the page losing its secure context, which disables `crypto.subtle`
and therefore the entire key vault.

**Root cause.** AppKit defaults `enableEIP6963` to `false`. The injected provider
was therefore never presented as a connector, and the modal steered every
connection to the WalletConnect relay. On mobile the relay path deeplinks into the
wallet app, which reopens the dApp on its own canonical URL — a plain-HTTP origin,
where the browser withholds Web Crypto.

**Fix.** `enableEIP6963: true, enableInjected: true` in `src/config/appkit.ts`.
The relay errors stopped entirely.

**Also added:** the header now shows the secure-context state as a badge and the
transfer page shows a blocking banner on an insecure origin, so the cause is
visible before a transfer is attempted rather than at the moment one fails.

### 10.2 The forward leg was estimated against the final recipient

**Symptom.** An on-chain revert, `gas_used 58636 / gas_limit 59070` — 99.3% of the
limit consumed:

```
decoded: transfer(to = <burner>, value = 100000)
result:  execution reverted
```

**Root cause.** The main-wallet → burner leg was estimated with the _final
recipient_ as the destination. That recipient already held the token, so its
balance slot was warm (~5 000 gas). The burner is fresh by construction, so its
slot is cold (~20 000 gas). The estimate was ~15 000 gas short.

This is §4.4 in the opposite direction: v1 estimated the recipient leg against the
burner, and the port fixed that by estimating both legs against the recipient.

**Fix.** `withDestination(request, burnerAddress)` in `transak.service.ts`, so the
forward leg is estimated against the address it is actually sent to.

**Why the suite missed it.** The mock charged a flat 55 000 gas for every ERC-20
`transfer`, so destination warmth could not affect the outcome. Two regression
tests were added, and the fix was **proven** by reintroducing the bug and watching
the suite fail:

```
FAIL  estimates the forward leg against the burner, not the final recipient
      Error: The contract rejected this transfer.
```

No funds were lost: recovery returned the full token balance and 0.0079 native.

### 10.3 Sweeps were priced at the ceiling, leaving 11× more dust than necessary

**Measured.** Reserve `21000 × maxFee 49.2 gwei = 0.0010332`, actual charge
`21000 × 21.2 gwei = 0.0004452`. The 0.000588 difference matched the leftover
balance to the last digit.

**The distinction that matters.** A node admits a transaction only when
`value + gasLimit × maxFeePerGas ≤ balance`. The EIP-1559 refund is credited
_after_ inclusion, so it cannot fund the transaction that earns it. The reserve
therefore **must** be the ceiling. What can legitimately be lowered is the
ceiling itself.

**Fix.** `sweepReserve` stays at `effectiveGasPrice`, and `sweepFeeQuote()` gives
the sweep its own tighter `maxFeePerGas` of `baseFee × 1.125 + tip` — one block of
base-fee growth, which is the most EIP-1559 permits.

**Verified on-chain.** The sweep carries `MAXFEE = 23.70 gwei` against 49.20 gwei
on the other legs, and dust fell from 0.000588 to 0.0000525 — an 11.2×
reduction. The residual decomposes exactly:
`21000 × (baseFee × 0.125) = 21000 × 2.5 gwei = 0.0000525`.

**A wrong assumption corrected along the way.** Arc's `eth_gasPrice` returns
`baseFee + tip`, not the base fee. `fetchFeeQuote` now reads `baseFeePerGas` from
the block header, batched with `getFeeData()`.

### 10.4 A regression of mine destroyed a key over a live balance

The most serious defect in this list was introduced by my own first attempt at
§10.3, and it cost 0.008096503 native permanently.

**What happened.** Burner `0x91FcA8f5…3454d`. The log read
`sweep-refund :: done :: No significant leftover to return`, and the session was
destroyed 200 ms later over a burner that still held its full balance.

**Root cause A — the reserve was below the admission threshold.** I had reserved
`21000 × expectedGasPrice (23.7 gwei) = 0.0004977`, but the node requires the
ceiling: `0.007598803 + 0.0010332 = 0.008632003 > 0.008096503`. Short by
0.0005355, so the sweep was **rejected** and never broadcast.

**Root cause B — and this is the real defect.** `recoverFromBurner` set
`nativeRecovered = true` whenever `balance ≤ sweepCost`, which conflated two
completely different situations: genuine unrecoverable dust, and _my reserve
being wrong_. The pipeline trusted that flag and destroyed the key.

**Fixes.**

1. `sweepReserve` back to the ceiling (§10.3).
2. The burner balance is **re-read from chain** after sweeping, rather than
   inferred from whether the sweep call returned.
3. `isUnrecoverableDust(balance, sweepCeiling)` names the genuine-dust case
   explicitly instead of letting it fall out of an inequality.
4. **`destroyBurnerSession` is gated on `nativeRecovered`.** If the sweep did not
   demonstrably succeed, the pipeline throws `RecoveryFailure` carrying the _live_
   vault handle, and the recovery panel offers the key. A key is never wiped over
   a balance the app cannot prove is gone.
5. The history row is recorded as `pending`, not `failed` — the recipient transfer
   may well have succeeded; only the refund did not.
6. The admission rule was added to the mock chain.

**Honest caveat.** Reintroducing the stranding bug did _not_ make the 39
integration tests fail, so I cannot claim the harness catches that specific
regression. The protection that actually holds is the key-destruction gate in
fix 4: even if the reserve maths is wrong again, the key survives and the funds
stay reachable.

### 10.5 What the nine runs measured

| Time  | Asset             | Outcome                                                     |
| ----- | ----------------- | ----------------------------------------------------------- |
| 14:30 | EURC (ERC-20)     | forward leg reverted (§10.2); recovery returned everything  |
| 14:48 | EURC              | full success; dust 0.000588                                 |
| 15:26 | EURC              | success, but the browser served cached code — invalid run   |
| 15:39 | cirBTC (ERC-20)   | **0.0081 stranded, key destroyed** (§10.4)                  |
| 15:57 | EURC              | success; dust 0.0000525, sweep `MAXFEE 23.70g`              |
| 16:19 | USDC (native)     | success; `forward-asset :: skipped`, dust 0.0000525         |
| 16:20 | EURC              | success                                                     |
| 16:21 | cirBTC            | success; `transfer` 40 504 / 59 675 gas, dust 0.0000525     |
| 16:22 | ArcFlow NFT (721) | success; `safeTransferFrom` 57 963 / 82 673, dust 0.0000525 |

The native run is structurally different and worth noting: three transactions
instead of four, with `forward-asset :: skipped`, because there is no separate
asset leg when the asset _is_ the gas token.

Dust of exactly 0.0000525 across native, two ERC-20s, and an ERC-721 — at two
different base-fee levels — is what establishes it as the structural floor
described in §9 rather than a coincidence.

**A methodology note.** The 15:26 run appeared to show the dust fix failing. It had
in fact served `gas.service.ts` from cache (a `304` with no fetch since before the
edit). Confirmed afterwards by decoding the HMR token in the request against the
file's mtime. Any conclusion drawn from a browser run needs the served code
verified first.

### 10.6 Incidentally validated

- **The error boundary works.** Two transient HMR states during the UI rewrite
  threw inside `<PipelineProgress>` and `<TransferPage>`; both were caught and the
  recovery screen rendered. Not a code defect — a half-applied cross-file edit —
  but its first validation against a real React error.
- **Recovery works under a real failure.** The 14:30 revert triggered the recovery
  path against a live chain: the token balance came back intact and 0.0079 native
  was returned.
- **RPC failover, batching, and receipt polling** all ran against real endpoints
  across nine runs with no rotation stall.

---

## Still not verified

- **ERC-1155 transfers.** ERC-721 is confirmed on-chain (§10.5); the 1155 path
  shares the standard-detection and dispatch code but was not exercised.
- **The kill switch mid-transfer.** Abort is covered in the suite but was never
  pressed during a live run, so the real-chain recovery-on-abort path is untested.
- **The rate limiter in the browser.** Covered by 13 unit tests with an injected
  clock; never tripped by real rapid submissions.
- **The `RecoveryFailure` path.** The most important protection added (§10.4,
  fix 4) has never been exercised end to end, because every sweep since has
  succeeded. Forcing it requires deliberately breaking the sweep.
- **Component rendering.** The suite is deliberately DOM-free (see §8), so
  components are covered by typecheck and lint but not by render tests.
- **Networks other than Arc Testnet.** The registry is config-driven and no chain
  id is hardcoded, but only one chain has ever been run.

---

## Dependency changes

| Package            | v1      | v2     | Note                                   |
| ------------------ | ------- | ------ | -------------------------------------- |
| `ethers`           | ^6.11.0 | 6.17.0 | pinned                                 |
| `@reown/appkit`    | ^1.6.0  | 1.8.23 | pinned                                 |
| `react`            | ^18.2.0 | 18.3.1 | 18.x retained; 19 not required         |
| `vite`             | ^5.1.6  | 7.3.6  |                                        |
| `typescript`       | —       | 5.9.3  | 7.x is too new for `typescript-eslint` |
| `zustand`          | —       | 5.0.14 | added                                  |
| `idb`              | —       | 8.0.3  | added                                  |
| `vitest`           | —       | 3.2.7  | added                                  |
| `react-responsive` | ^10.0.1 | —      | removed; CSS media queries suffice     |

All versions are **exact-pinned** — no `^` ranges — so `npm ci` installs an
identical tree everywhere.

**Package manager: pnpm → npm.** The stale `pnpm-lock.yaml` no longer matched the
rewritten `package.json`, and `pnpm` was unavailable in the verification
environment. `package-lock.json` is committed and CI runs `npm ci`.

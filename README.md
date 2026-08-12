# Arc Secure Transak 🔒

**Arc Secure Transak** is an anti-drainer transfer dApp. It moves native coins,
ERC-20 tokens, and NFTs to a destination without your main wallet ever signing a
transaction addressed to that destination.

Your wallet signs at most two transactions, both to addresses under this app's
control. A freshly generated, encrypted, single-use **burner wallet** performs the
only call that touches the recipient. If the recipient turns out to be hostile, the
maximum it can take is the amount deliberately placed in the burner — your main
wallet granted no approval and signed nothing addressed to it.

Built for **Arc Testnet**, with a config-driven chain registry so other EVM
networks need only a config entry. Verified end to end on-chain across native,
ERC-20, and ERC-721 transfers.

---

## Why this exists

A normal transfer to a malicious contract is dangerous because your wallet signs a
transaction _addressed to that contract_. Anything the contract does — draining an
approval, re-entering, front-running — happens with your address as `msg.sender`.

This app inserts an isolated intermediary:

```
[ Your Wallet ] ──(1. gas funding, plain value transfer)──> [ Burner (in memory) ]
       │                                                            │
       └────(2. asset transfer, only for tokens/NFTs)────────────────┤
                                                                    │
                                                     (3. the only call to the
                                                         untrusted recipient)
                                                                    ▼
                                                          [ Final Recipient ]
```

Steps 1 and 2 go to addresses the app controls. Step 3 originates from a throwaway
key that is destroyed immediately afterwards.

---

## Security model

**The burner key never exists as a plain variable.** It lives inside a `WeakMap`
keyed by an opaque handle, encrypted with **AES-256-GCM** under a
**non-extractable** `CryptoKey`. Plaintext exists only inside a scoped callback and
is overwritten with random bytes then zeros before that callback returns — even if
it throws.

**Nothing is written to disk.** No `localStorage`, no `sessionStorage`, no
IndexedDB, no cookies, no console. Closing the tab destroys the key.

**The key is never logged.** If automatic recovery fails, the app shows a recovery
panel with a two-stage gate — expand the danger section, tick an explicit
acknowledgement — before revealing the key. The revealed value auto-hides after
60 seconds and is never logged or transmitted.

**Every input is validated before a wallet prompt.** Addresses require a `0x`
prefix and a valid EIP-55 checksum, and burn/system addresses are blocked. Amounts
reject exponent notation, separators, negatives, and more decimals than the asset
supports. Rate limiting (5/minute, 3-second cooldown) is applied before any wallet
interaction, so a throttled attempt costs nothing.

Full detail, including what is _not_ protected against, is in
[`UPGRADE_REPORT.md`](./UPGRADE_REPORT.md).

---

## The ten-step pipeline

Each step reports progress individually, so you can see exactly where a transfer is.

| #   | Step                    | What happens                                                   |
| --- | ----------------------- | -------------------------------------------------------------- |
| 1   | Verify wallet session   | Confirm the signer is live and the recipient is valid          |
| 2   | Validate network        | Confirm the wallet's chain matches the selected chain          |
| 3   | Create encrypted burner | Generate a random key, seal it with AES-GCM                    |
| 4   | Simulate gas            | Real `estimateGas` against the target contract                 |
| 5   | Pre-flight balances     | Verify native and asset balances, and NFT ownership            |
| 6   | Fund burner             | **Signature 1** — plain value transfer to the burner           |
| 7   | Forward asset           | **Signature 2** — token/NFT to the burner (skipped for native) |
| 8   | Dispatch to recipient   | The burner sends. **No user signature.**                       |
| 9   | Sweep and refund        | Return leftover gas to your wallet                             |
| 10  | Destroy session         | Wipe ciphertext, IV, and vault entry                           |

If anything fails after step 6, recovery sweeps the asset and then the leftover gas
back to your wallet — including after a user-initiated abort. Recovery runs to
completion regardless of the abort signal, because honouring it there would strand
the funds.

The burner's funding in step 6 explicitly budgets for the step 9 sweep plus a
safety buffer, so the burner can always afford to return what it holds.

**Step 10 is gated on step 9.** The key is wiped only after the burner's balance is
re-read from chain and confirmed drained. If the sweep did not demonstrably
succeed, the app keeps the key alive and shows the recovery panel instead — a key is
never destroyed over a balance the app cannot prove is gone.

---

## Features

- **Native, ERC-20, ERC-721, and ERC-1155 transfers.** NFT standards are confirmed
  via ERC-165 before dispatch.
- **Kill switch.** Abort at any point; assets are recovered automatically.
- **Multi-RPC failover.** Five endpoints with rotation, exponential backoff, and
  jitter. A latency probe promotes the fastest endpoint per session.
- **Gas simulation.** Real estimates with a documented fallback, and the UI says
  when a figure is approximate.
- **Fee priority.** Standard / Fast / Instant.
- **Transaction history.** IndexedDB with cursor pagination, per chain.
- **Address book.** Search, JSON export/import.
- **Dark and light themes.** Follows your OS preference on first visit.
- **Multi-chain ready.** Add a network with one config entry.

---

## The interface

Three tabs: **Transfer**, **History**, and **How it works**.

The transfer tab shows the ten stages as a timeline _before_ you start, with the two
stages that need a wallet signature tagged as such — so an unexpected third prompt
is immediately recognisable as wrong. During a run each stage reports its own state
and elapsed time, and a receipt appears afterwards with the recipient, block, gas
used, gas returned, burner address, and transaction hash, each linked to the
explorer.

The activity log is structured rather than a scrolling wall of text. It defaults to
**Milestones** — completed and failed stages only — with Detailed and Issues filters
available, and a copy button that produces plain text suitable for a bug report.

**How it works** documents the threat model, the guarantee, key handling, all ten
stages, and — in a section of its own — what the tool does _not_ protect against.
That last part is deliberate: a user who believes this eliminates all risk will take
risks they otherwise would not.

The header shows whether the page has a secure context. Without one the browser
withholds `crypto.subtle`, the vault cannot operate, and the app refuses transfers
rather than holding a key unencrypted.

---

## Quickstart

Running locally is recommended over any hosted deployment: it means the code
handling your keys is code you can read.

```bash
git clone https://github.com/endijuan33/arc-secure-transak.git
cd arc-secure-transak

npm install

cp .env.example .env
# Edit .env and set VITE_REOWN_PROJECT_ID (free from https://cloud.reown.com)

npm run dev
```

Requires **Node 20.19+**. The app must be served over **HTTPS or localhost** —
`crypto.subtle` is unavailable in an insecure context, and without it the encrypted
vault cannot operate.

### Scripts

| Command                     | Purpose                          |
| --------------------------- | -------------------------------- |
| `npm run dev`               | Dev server                       |
| `npm run build`             | Typecheck, then production build |
| `npm run verify`            | Typecheck + lint + tests + build |
| `npm test`                  | Tests in watch mode              |
| `npm run test:coverage`     | Coverage report                  |
| `npm run lint` / `lint:fix` | ESLint                           |
| `npm run format`            | Prettier                         |

---

## Project layout

```
src/
├── security/     Key vault (AES-GCM), zeroization, validation, rate limiting
├── config/       Chain registry, constants, ABIs, AppKit setup
├── services/     RPC pool, gas, burner, token, NFT, pipeline, history
├── store/        Zustand stores (session, transfer, notifications)
├── hooks/        useWallet, useBalances, useGas, useTransak, useBurnerWallet, …
├── components/   Presentational components
└── pages/        TransferPage

tests/
├── unit/         286 tests
├── integration/  39 tests against an in-process mock chain
└── helpers/      Mock EVM with real signing
```

Dependencies point strictly downward: `services/` imports no React,
`components/` imports no ethers.

---

## Adding a chain

One entry in `src/config/chains.ts`:

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
    apiBase: null, // no Blockscout API → NFT tab hides itself
  },
  knownTokens: [],
  fallbackGasPriceWei: 1_000_000_000n,
  gasSafetyBufferWei: 1_000_000_000_000_000n,
  supportsEip1559: true,
};

export const SUPPORTED_CHAINS = [ARC_TESTNET, BASE_SEPOLIA];
```

The chain selector appears automatically once more than one chain is registered.
No chain id is hardcoded anywhere else.

---

## Testing

325 tests, no network access required. Transaction-level tests run against an
in-process mock EVM that models balances, nonces, gas accounting, receipt latency,
per-destination ERC-20 gas costs, the EIP-1559 admission rule, and per-method
failure injection — while using **real ethers `Wallet` signing**, so the
decrypt → derive → verify → sign → broadcast path is genuinely exercised.

```bash
npm run test:run
```

The suite is not the whole story. Four defects were found only by running the app in
a browser against a live chain, each one hiding behind a place where the mock was
more forgiving than a node. They are documented in
[§10 of the upgrade report](./UPGRADE_REPORT.md#10-browser-and-on-chain-verification),
along with what the mock got wrong in each case.

---

## Limitations

Worth reading before moving anything valuable.

- **A lying token contract is not detected.** A `transfer` that returns `true`
  without moving anything yields a successful receipt. Detecting it would require a
  post-transfer balance read on every transfer.
- **The burner window is irreducible.** Between funding and dispatch, assets are
  held by an address whose key exists only in this tab's memory. If the tab dies
  there, recovery cannot run and the assets are reachable only via the revealed key.
- **Each burner keeps a residual balance.** About 0.0000525 native on Arc Testnet.
  This is structural, not an estimation error: a node requires the full worst-case
  fee to be available before it accepts the sweep, and the EIP-1559 refund arrives
  afterwards. The residual is one block of base-fee headroom on the sweep, and
  removing it would risk the sweep being rejected outright.
- **Rate limiting is per-tab.** A reload resets it. It guards against accidents,
  not adversaries.
- **Testnet only.** Verified on Arc Testnet across native, ERC-20, and ERC-721
  transfers. ERC-1155, the mid-transfer abort path, and any other network remain
  unverified on-chain — see
  [Still not verified](./UPGRADE_REPORT.md#still-not-verified). Test with a small
  amount first.

---

## Documentation

- [`UPGRADE_REPORT.md`](./UPGRADE_REPORT.md) — what changed in v2, why, the v1 bugs
  it fixed, and the four defects that only a live chain revealed
- [`MIGRATION_GUIDE.md`](./MIGRATION_GUIDE.md) — for developers coming from v1
- [`UPGRADE_PLAN.md`](./UPGRADE_PLAN.md) — historical v1 roadmap

---

## Contributing

`npm run verify` must pass. The project is strict TypeScript with no `any`, and
ESLint enforces that. See the gotchas section of the migration guide for the
non-obvious constraints (`exactOptionalPropertyTypes`, no `setState` in effects,
contract calls via `services/contract.ts`).

---

Powered by the Arc community. Built with React, TypeScript, ethers v6, and Reown
AppKit.

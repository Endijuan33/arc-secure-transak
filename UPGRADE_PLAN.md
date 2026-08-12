# Arc Secure Transak — Upgrade & Roadmap Plan

This document outlines the planned technical improvements, architectural expansions, and user experience (UX) enhancements for future releases of Arc Secure Transak. The plan is structured in phases, prioritizing features that deliver the most value while maintaining the project's core security principles.

---

## Current Stack Status (Base Version 1.0.0)

Before upgrading, ensure the following baseline is stable:

- React 18 + Vite
- Reown AppKit (WalletConnect) with ethers v6
- Multi-RPC failover (5 endpoints)
- In-memory burner wallet with full recovery
- Kill-switch (AbortController)
- Address book (localStorage)
- Transaction history with pagination
- ArcScan API v2 integration with RPC fallback
- Global error boundary (main.jsx)

---

## 🚀 Phase 1: UX & Interface Enhancements

### 1.1 ENS / Web3 Domain Resolver

- **Objective:** Allow users to input human-readable names (e.g., `alice.arc`, `vitalik.eth`) instead of raw hex addresses.
- **Implementation Plan:**
  - Add a new utility function `resolveDomain(domain)` in `src/utils/helpers.js` using the provider's `resolveName` method (ethers v6).
  - In `DestinationInput.jsx`, when user blurs the input, attempt to resolve the domain asynchronously.
  - On success, replace the input value with the resolved address and show a success toast.
  - On failure, show a warning toast but allow manual override.
- **Files to modify:** `src/utils/helpers.js`, `src/components/DestinationInput.jsx`
- **Dependencies:** None (ethers already supports ENS resolution via provider).

### 1.2 Real-Time Fiat Currency Conversion (USD/IDR)

- **Objective:** Display approximate USD/IDR value of the selected token amount.
- **Implementation Plan:**
  - Create a new hook `useTokenPrice(tokenSymbol)` in `src/hooks/useTokenPrice.js` that fetches price from CoinGecko or a decentralized oracle.
  - In `App.jsx`, when the user types an amount, display the converted value below the input.
  - Cache price data with TTL (e.g., 60 seconds) to avoid rate limiting.
- **Files to modify:** `src/hooks/useTokenPrice.js` (new), `src/App.jsx`
- **Dependencies:** Need to add a lightweight fetch library (or use native `fetch`). Consider fallback if API is down.

### 1.3 Advanced Gas Speed Selector

- **Objective:** Let users choose transaction priority (Standard, Fast, Instant) to adjust gas multiplier.
- **Implementation Plan:**
  - Add a new state `gasSpeed` in `App.jsx` with values: `'standard'`, `'fast'`, `'instant'`.
  - Map each speed to a multiplier: `standard: 110n`, `fast: 150n`, `instant: 200n`.
  - Pass `gasMultiplier` to `executeAbsoluteSecureTransak` (modify function signature to accept optional `gasMultiplier`).
  - Show a toggle or dropdown in the UI next to the "Send Securely" button.
- **Files to modify:** `src/App.jsx`, `src/utils/secureTransak.js`
- **Note:** Default behavior remains as current `GAS_MULTIPLIER = 150n`; only override when user selects a speed.

---

## ⚙️ Phase 2: Functional Expansion

### 2.1 Dynamic Custom Token Importer

- **Objective:** Allow users to add any ERC-20 token by contract address, removing dependency on hardcoded `KNOWN_TOKENS`.
- **Implementation Plan:**
  - Create a new component `AddTokenModal` that prompts for token address.
  - Use `fetchTokenInfo` from `tokenUtils.js` to retrieve symbol and decimals.
  - Save custom tokens in `localStorage` under a new key `CUSTOM_TOKENS_KEY`.
  - Merge custom tokens with `KNOWN_TOKENS` in `useBalances.js` before fetching balances.
  - Add a "Manage Tokens" section in UI (maybe in a collapsible panel).
- **Files to modify:** `src/config/constants.js` (add key), `src/components/AddTokenModal.jsx` (new), `src/hooks/useBalances.js`, `src/App.jsx`
- **Dependencies:** None.

### 2.2 Batch / Multi-Send Capability

- **Objective:** Enable users to send tokens to multiple recipients in one workflow.
- **Implementation Plan:**
  - Add a new mode in UI that allows adding multiple recipient rows.
  - Validate each address and amount.
  - Modify `executeAbsoluteSecureTransak` to accept an array of `{ recipient, amount }`.
  - The burner wallet will sequentially execute transfers within one session (still only one funding transaction).
  - Ensure the refund logic accounts for total gas used.
- **Files to modify:** `src/App.jsx` (new mode), `src/utils/secureTransak.js`
- **Complexity:** Medium; requires careful handling of nonce and gas.

### 2.3 Address Book Cloud Sync / Export

- **Objective:** Prevent data loss and allow cross-device use.
- **Implementation Plan:**
  - Add "Export" button that downloads a JSON file of the address book.
  - Add "Import" button that uploads a JSON file and merges with existing entries (avoid duplicates).
  - (Optional) Implement browser storage sync via a public service if user opts in.
- **Files to modify:** `src/components/Footer.jsx` (or a new component), `src/utils/helpers.js`
- **Complexity:** Low.

---

## 🏗️ Phase 3: Architectural & Performance Optimizations

### 3.1 Latency-Based RPC Ping Race

- **Objective:** Reduce connection lag by picking the fastest RPC on startup.
- **Implementation Plan:**
  - On app mount (or wallet connect), ping all RPCs in `RPC_URLS` with a simple `eth_blockNumber` request.
  - Measure response time; select the fastest as the primary provider for the session.
  - Keep fallback list sorted by latency for retries.
- **Files to modify:** `src/config/reown.js` (or new service), `src/utils/secureTransak.js`, `src/hooks/useBalances.js`
- **Complexity:** Medium.

### 3.2 Smart Contract Account Abstraction (ERC-4337 Exploration)

- **Objective:** Reduce transaction overhead and gas costs by eliminating the burner wallet funding step using meta-transactions.
- **Implementation Plan:**
  - This is a major architectural change. Start with research on deploying a simple forwarder contract on Arc Testnet.
  - The forwarder would accept signed messages (EIP-712) from the user and execute the transfer on their behalf.
  - The user would only sign one message; the forwarder pays gas (sponsored or prepaid).
  - This would replace the burner wallet workflow entirely, requiring a complete rewrite of `secureTransak.js`.
- **Files to modify:** `src/utils/secureTransak.js` (major refactor), new smart contract files.
- **Complexity:** High; requires deep understanding of ERC-4337 and solidity.

---

## 🔧 Supporting Improvements

### 4.1 Better Error Messaging & Monitoring

- **Objective:** Provide more actionable error messages and optional remote logging.
- **Implementation Plan:**
  - Extend `parseUserFriendlyError` with more specific messages for common errors.
  - Add an optional "Report Error" button that sends logs to a configured endpoint (disabled by default).

### 4.2 Unit & Integration Testing

- **Objective:** Ensure reliability with test coverage.
- **Implementation Plan:**
  - Set up Vitest and React Testing Library.
  - Write tests for core functions: `isAddress`, `safeFormat`, `withAutoRetry` mock, and component interactions.
  - Add integration test for end-to-end transaction flow using local hardhat node.

---

## 🔖 Priority Guide

| Priority | Feature                        | Reason                                           |
| -------- | ------------------------------ | ------------------------------------------------ |
| **P0**   | 2.1 Custom Token Importer      | Removes hardcoded dependency; user-driven        |
| **P1**   | 1.1 ENS Resolver               | Improves UX drastically                          |
| **P1**   | 1.3 Gas Speed Selector         | Gives user control over costs                    |
| **P2**   | 2.3 Address Book Export/Import | Prevents data loss                               |
| **P2**   | 3.1 RPC Ping Race              | Improves perceived performance                   |
| **P3**   | 1.2 Fiat Conversion            | Nice-to-have; depends on external API            |
| **P3**   | 2.2 Batch Send                 | Complex; user demand may justify                 |
| **P4**   | 3.2 ERC-4337                   | Long-term research; game-changer but high effort |

---

## 🗃️ Directory structure

|arc-secure-transak
├── README.md
├── index.html
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── public
│   ├── arc-logo.png
│   └── arc-logo.svg
├── src
│   ├── App.jsx
│   ├── assets
│   │   └── tokens
│   │   ├── cirbtc.svg
│   │   ├── eurc.svg
│   │   └── usdc.svg
│   ├── components
│   │   ├── AccountInfo.jsx
│   │   ├── DestinationInput.jsx
│   │   ├── Footer.jsx
│   │   ├── Header.jsx
│   │   └── TokenSelector.jsx
│   ├── config
│   │   ├── constants.js
│   │   ├── reown.js
│   │   └── tokens.js
│   ├── hooks
│   │   └── useBalances.js
│   ├── index.css
│   ├── main.jsx
│   └── utils
│   ├── helpers.js
│   ├── secureTransak.js
│   └── tokenUtils.js
└── vite.config.js

9 directories, 26 files

---

## 📁 File Impact Summary

| File                                  | Affected Upgrades                |
| ------------------------------------- | -------------------------------- |
| `src/App.jsx`                         | 1.1, 1.2, 1.3, 2.1, 2.2          |
| `src/components/DestinationInput.jsx` | 1.1                              |
| `src/utils/helpers.js`                | 1.1, 2.3                         |
| `src/utils/secureTransak.js`          | 1.3, 2.2, 3.1, 3.2               |
| `src/hooks/useBalances.js`            | 2.1                              |
| `src/config/constants.js`             | 2.1                              |
| `src/config/reown.js`                 | 3.1                              |
| `src/utils/tokenUtils.js`             | 2.1 (already has fetchTokenInfo) |
| `src/hooks/useTokenPrice.js`          | 1.2 (new file)                   |

---

_Last updated: July 2026_

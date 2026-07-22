# Arc Secure Transak 🔒

**Arc Secure Transak** is a high-security decentralized application (dApp) built for the **Arc Testnet**, designed specifically to protect users from malicious "wallet drainers", automated front-running bots, and signature-exploiting dApps. 

By routing all transfers through an isolated, in-memory ephemeral ("burner") wallet, the dApp ensures that user main wallets never interact directly with untrusted destination contracts or protocols.

## 🛡️ How It Works: The Anti-Security & Anti-Drainer Architecture

Standard dApps require users to interact directly with external contracts using their primary wallet, opening windows of vulnerability for malicious scripts to siphon unauthorized assets. Arc Secure Transak mitigates this threat via a strict **10-Step Secure Execution Pipeline**:



[ Main Wallet ] ──(1. Fund Gas / Transfer Token)──> [ Burner Wallet (In-Memory) ]
│
(2. Execute Final Tx)
▼
[ Final Recipient ]

### Technical Workflow Breakdown:

1. **Connection & Validation Validation:**
   - The dApp connects via **Reown AppKit** and verifies that the active provider is connected strictly to the **Arc Testnet** (Chain ID: `5042002`).
2. **Ephemeral Burner Generation:**
   - Generates a cryptographically secure, random temporary wallet directly in the browser's memory (`ethers.Wallet.createRandom()`). This wallet never touches `localStorage` or persistent storage.
3. **Dynamic Gas & Fee Calculation:**
   - Evaluates EIP-1559 network fees and calculates exact native gas requirements alongside a safety buffer (`SAFETY_BUFFER`).
4. **Pre-Flight Balance Checks:**
   - Validates that the primary wallet holds sufficient native assets (for gas allocation) and/or ERC-20 tokens (with custom ABI error-catching to prevent `missing revert data` crashes on invalid contract calls).
5. **Isolated Gas Funding:**
   - The user’s primary wallet sends a singular, isolated native transaction to fund the ephemeral burner wallet strictly with the necessary gas amount.
6. **Token Forwarding (ERC-20 Path):**
   - If an ERC-20 token (e.g., EURC, cirBTC) is selected, the primary wallet transfers the requested token amount to the temporary burner wallet.
7. **Nonce Synchronization & Final Dispatch:**
   - The burner wallet fetches its pending nonce and securely broadcasts the final transfer transaction to the target recipient. Because the transaction originates from a disposable address, the primary wallet's exposure footprint is zero.
8. **Automated Leftover Sweep & Refund:**
   - Once the final transaction is confirmed on-chain, any remaining native gas asset in the burner wallet is automatically refunded back to the user's primary wallet.
9. **Instant Cryptographic Destruction:**
   - Session keys (`sessionPrivateKey` and `sessionBurnerAddress`) are forcefully set to `null`, completely wiping the temporary credentials from memory.
10. **Emergency Recovery Failsafe:**
    - If any unexpected network failure or manual abort occurs mid-execution, a built-in recovery block attempts to sweep stranded assets back to the main wallet. If recovery fails, the burner private key is outputted to the console/status log as a final fallback.

## 🚀 Key Features

* **Kill-Switch & Manual Abort:** Users can abort ongoing transactions at any time via a dedicated React `AbortController` stream.
* **Multi-RPC Failover System:** Automatically cycles through a prioritized list of RPC providers (dRPC, Thirdweb, Blockdaemon, Quicknode) if a timeout or node congestion occurs (`-32011`).
* **Global Error Boundary:** Protects the React application tree from the "White Screen of Death" (WSOD) via a robust root-level error boundary.
* **Strict Input Sanitization:** Real-time regex filtering on token amount inputs prevents invalid decimals, alphabet characters, and formatting errors.

// src/utils/secureTransak.js
import { ethers } from "ethers";
import { transferERC20 } from './tokenUtils';

const ARC_TESTNET_CHAIN_ID = 5042002;
const RPC_URLS = [
  'https://rpc.drpc.testnet.arc.network',
  'https://rpc.testnet.arc.network',
  'https://5042002.rpc.thirdweb.com',
  'https://rpc.blockdaemon.testnet.arc.network',
  'https://rpc.quicknode.testnet.arc.network'
];
const GAS_MULTIPLIER = 150n;

let sessionPrivateKey = null;
let sessionBurnerAddress = null;

// -------------------------------------------------------------------
// Interruptible delay – immediately throws on abort
// -------------------------------------------------------------------
const abortableDelay = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(new Error("MANUAL_ABORT"));
  const timer = setTimeout(resolve, ms);
  if (signal) {
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error("MANUAL_ABORT"));
    }, { once: true });
  }
});

// -------------------------------------------------------------------
// Auto‑Retry with RPC fallback and abort support
// -------------------------------------------------------------------
async function withAutoRetry(
  operationName,
  asyncOperation,
  onStatusUpdate,
  maxRetries = 5,
  rpcProviderRef = null,
  rpcList = null,
  signal = null
) {
  let attempt = 0;
  let lastError = null;
  let currentRpcIndex = 0;

  while (attempt < maxRetries) {
    if (signal?.aborted) throw new Error("MANUAL_ABORT");
    try {
      return await asyncOperation();
    } catch (error) {
      if (signal?.aborted) throw new Error("MANUAL_ABORT");
      attempt++;
      lastError = error;
      const errStr = error?.message || String(error);

      const isUserRejection = errStr.includes("user rejected") || errStr.includes("ACTION_REJECTED");
      const isInsufficientFunds = errStr.includes("insufficient funds");
      const isWalletDisconnected = errStr.includes("not connected") || errStr.includes("session expired");
      if (isUserRejection || isInsufficientFunds || isWalletDisconnected) throw error;

      const isTransient = errStr.includes("-32011") ||
                          errStr.includes("request limit reached") ||
                          errStr.includes("network") ||
                          errStr.includes("timeout") ||
                          errStr.includes("ETIMEDOUT") ||
                          errStr.includes("coalesce error") ||
                          errStr.includes("connect") ||
                          errStr.includes("econnrefused");

      if (isTransient && rpcProviderRef && rpcList && rpcList.length > 0) {
        const nextIndex = (currentRpcIndex + 1) % rpcList.length;
        if (nextIndex !== currentRpcIndex) {
          const newRpc = rpcList[nextIndex];
          onStatusUpdate(`⚠️ ${operationName}: Switching RPC to ${newRpc}...`);
          rpcProviderRef.provider = new ethers.JsonRpcProvider(newRpc);
          currentRpcIndex = nextIndex;
        }
        await abortableDelay(4000 * attempt, signal);
        continue;
      }

      if (isTransient && attempt < maxRetries) {
        onStatusUpdate(`⚠️ ${operationName}: Network busy. Auto-reconnecting...`);
        await abortableDelay(4000 * attempt, signal);
      } else {
        throw error;
      }
    }
  }
  throw lastError || new Error(`Operation ${operationName} failed.`);
}

// -------------------------------------------------------------------
// Safe transaction confirmation with abort support
// -------------------------------------------------------------------
async function safeWaitForTransaction(provider, txHash, onStatusUpdate, maxRetries = 40, intervalMs = 5000, signal = null) {
  let attempt = 0;
  while (attempt < maxRetries) {
    if (signal?.aborted) throw new Error("MANUAL_ABORT");
    try {
      const receipt = await withAutoRetry(
        'Fetch Receipt',
        () => provider.getTransactionReceipt(txHash),
        onStatusUpdate,
        3,
        null,
        null,
        signal
      );
      if (receipt && receipt.blockNumber !== null) return receipt;
    } catch (error) {
      if (error.message === "MANUAL_ABORT") throw error;
      console.warn(`Receipt fetch attempt ${attempt+1} failed:`, error.message);
    }
    attempt++;
    await abortableDelay(intervalMs, signal);
  }
  throw new Error("Transaction confirmation timeout.");
}

// -------------------------------------------------------------------
// Friendly error messages
// -------------------------------------------------------------------
function parseUserFriendlyError(error) {
  const errString = error?.message || String(error);
  if (errString.includes("-32011") || errString.includes("request limit reached")) {
    return "RPC network persistently busy. Please try again later.";
  }
  if (errString.includes("insufficient funds")) {
    return "Insufficient wallet balance to cover transfer amount and gas fees.";
  }
  if (errString.includes("user rejected") || errString.includes("ACTION_REJECTED")) {
    return "Transaction rejected by user in wallet.";
  }
  if (errString.includes("network") || errString.includes("connection")) {
    return "Failed to connect to the network. Check your internet or RPC server.";
  }
  if (errString.includes("timeout")) {
    return "Operation timed out. The network may be congested; please try again.";
  }
  if (errString.includes("not connected") || errString.includes("no provider")) {
    return "Wallet is not connected or session expired. Please reconnect your wallet.";
  }
  return errString.length > 120 ? errString.substring(0, 120) + "..." : errString;
}

// -------------------------------------------------------------------
// Build transaction config (EIP-1559 / legacy)
// -------------------------------------------------------------------
function buildTxConfig(to, value, gasLimit, nonce, feeData) {
  const config = { to, value, gasLimit };
  if (nonce !== null && nonce !== undefined) {
    config.nonce = nonce;
  }
  if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
    config.maxFeePerGas = feeData.maxFeePerGas;
    config.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
  } else if (feeData.gasPrice) {
    config.gasPrice = feeData.gasPrice;
  } else {
    config.gasPrice = ethers.parseUnits("2", "gwei");
  }
  return config;
}

// -------------------------------------------------------------------
// Extract only gas-related overrides from a full config object
// (used for contract method calls where `to` and `value` cannot be overridden)
// -------------------------------------------------------------------
function extractGasOverrides(config) {
  const overrides = {};
  if (config.gasLimit) overrides.gasLimit = config.gasLimit;
  if (config.maxFeePerGas) overrides.maxFeePerGas = config.maxFeePerGas;
  if (config.maxPriorityFeePerGas) overrides.maxPriorityFeePerGas = config.maxPriorityFeePerGas;
  if (config.gasPrice) overrides.gasPrice = config.gasPrice;
  return overrides;
}

// -------------------------------------------------------------------
// MAIN EXPORT – with kill‑switch signal and full recovery
// -------------------------------------------------------------------
export async function executeAbsoluteSecureTransak({
  provider,
  signer,
  recipientAddress,
  amountUSDC,
  tokenAddress = null,
  tokenDecimals = 18,
  onStatusUpdate,
  signal = null
}) {
  sessionPrivateKey = null;
  sessionBurnerAddress = null;

  let rpcProvider = new ethers.JsonRpcProvider(RPC_URLS[0]);
  const rpcProviderRef = { provider: rpcProvider };
  let mainAddress = null;

  try {
    if (signal?.aborted) throw new Error("MANUAL_ABORT");

    // 0. Verify wallet connection
    onStatusUpdate("Verifying wallet connection...");
    try {
      mainAddress = await signer.getAddress();
    } catch {
      throw new Error("Wallet not connected or session expired. Please reconnect your wallet.");
    }

    // 1. Validate network
    onStatusUpdate("Checking Arc Testnet network connection...");
    const network = await withAutoRetry(
      "Network Validation",
      () => provider.getNetwork(),
      onStatusUpdate,
      5,
      null,
      null,
      signal
    );
    if (Number(network.chainId) !== ARC_TESTNET_CHAIN_ID) {
      throw new Error(`Invalid network. Please connect to Arc Testnet (Chain ID: ${ARC_TESTNET_CHAIN_ID})`);
    }

    // 2. Create burner wallet with the current RPC provider
    onStatusUpdate("Creating secure temporary wallet in memory...");
    const burnerWallet = ethers.Wallet.createRandom().connect(rpcProviderRef.provider);
    sessionPrivateKey = burnerWallet.privateKey;
    sessionBurnerAddress = burnerWallet.address;

    // 3. Gas estimation & dynamic limit
    onStatusUpdate("Estimating gas fees...");
    let feeData = await withAutoRetry(
      "Fetch Fee Data",
      () => rpcProviderRef.provider.getFeeData(),
      onStatusUpdate,
      5,
      rpcProviderRef,
      RPC_URLS,
      signal
    );
    // If provider changed during retry, reconnect burner wallet to the new provider
    burnerWallet.connect(rpcProviderRef.provider);

    let estimatedGasLimit = 21000n;
    if (tokenAddress) {
      onStatusUpdate("Estimating gas for ERC-20 transfer...");
      const tokenContract = new ethers.Contract(
        tokenAddress,
        ['function transfer(address to, uint256 amount) returns (bool)'],
        rpcProviderRef.provider
      );
      try {
        const estimate = await tokenContract.transfer.estimateGas(burnerWallet.address, amountUSDC);
        estimatedGasLimit = (estimate * 120n) / 100n;
        onStatusUpdate(`✅ Estimated gas: ${estimatedGasLimit.toString()}`);
      } catch (e) {
        console.warn("Gas estimation failed, using safe fallback:", e.message);
        estimatedGasLimit = 150000n;
      }
    }

    let gasPrice = feeData.gasPrice || feeData.maxFeePerGas || ethers.parseUnits("2", "gwei");
    let estimatedGasCost = (estimatedGasLimit * gasPrice * GAS_MULTIPLIER) / 100n;
    const safetyBuffer = ethers.parseEther("0.005");
    const nativeNeededForGas = estimatedGasCost + safetyBuffer;
    const totalFundingNeeded = tokenAddress ? nativeNeededForGas : amountUSDC + nativeNeededForGas;

    // 4. Check native balance
    let mainBalance = await withAutoRetry(
      "Check Main Balance",
      () => provider.getBalance(mainAddress),
      onStatusUpdate,
      5,
      null,
      null,
      signal
    );
    if (mainBalance < totalFundingNeeded) {
      throw new Error(`Insufficient native balance to cover gas fees${tokenAddress ? ' and transfer amount.' : '.'}`);
    }

    // 4b. Check ERC-20 balance
    if (tokenAddress) {
      onStatusUpdate("Verifying ERC-20 token balance...");
      const tokenContract = new ethers.Contract(
        tokenAddress,
        ['function balanceOf(address) view returns (uint256)'],
        provider
      );

      try {
        const tokenBalance = await tokenContract.balanceOf(mainAddress);
        if (tokenBalance < amountUSDC) {
          throw new Error("Insufficient ERC-20 token balance for this transfer.");
        }
      } catch (err) {
        const errStr = err?.message || String(err);
        if (errStr.includes("missing revert data") || errStr.includes("CALL_EXCEPTION") || errStr.includes("0x70a08231")) {
          throw new Error(`Invalid Token: Contract ${tokenAddress.slice(0,6)}... is not deployed on Arc Testnet.`);
        }
        throw err;
      }
    }


    // 5. Fund burner (only signature)
    onStatusUpdate("Sending native funds for gas allocation...");
    const fundingTxConfig = buildTxConfig(burnerWallet.address, totalFundingNeeded, estimatedGasLimit, null, feeData);
    const txFunding = await withAutoRetry(
      "Send Funding",
      () => signer.sendTransaction(fundingTxConfig),
      onStatusUpdate,
      5,
      null,
      null,
      signal
    );
    onStatusUpdate("Waiting for funding confirmation...");
    await safeWaitForTransaction(provider, txFunding.hash, onStatusUpdate, 40, 5000, signal);

    // 6. Transfer ERC‑20 to burner (if any)
    if (tokenAddress) {
      onStatusUpdate(`Transferring ERC-20 token (${tokenAddress}) to temporary wallet...`);
      const tokenContract = new ethers.Contract(
        tokenAddress,
        ['function transfer(address to, uint256 amount) returns (bool)'],
        signer
      );
      const tokenTxConfig = buildTxConfig(burnerWallet.address, amountUSDC, estimatedGasLimit, null, feeData);
      const gasOverrides = extractGasOverrides(tokenTxConfig);
      const txToken = await withAutoRetry(
        "Transfer Token to Burner",
        () => tokenContract.transfer(burnerWallet.address, amountUSDC, gasOverrides),
        onStatusUpdate,
        5,
        null,
        null,
        signal
      );
      await safeWaitForTransaction(provider, txToken.hash, onStatusUpdate, 40, 5000, signal);
    }

    // 7. Refresh gas & nonce
    onStatusUpdate("Refreshing gas price for final transaction...");
    feeData = await withAutoRetry(
      "Fetch Fee Data (final)",
      () => rpcProviderRef.provider.getFeeData(),
      onStatusUpdate,
      5,
      rpcProviderRef,
      RPC_URLS,
      signal
    );
    burnerWallet.connect(rpcProviderRef.provider); // ensure burner uses latest provider
    gasPrice = feeData.gasPrice || feeData.maxFeePerGas || ethers.parseUnits("2", "gwei");
    estimatedGasCost = (estimatedGasLimit * gasPrice * GAS_MULTIPLIER) / 100n;

    let burnerNonce = await withAutoRetry(
      "Get Burner Nonce",
      () => rpcProviderRef.provider.getTransactionCount(burnerWallet.address, 'pending'),
      onStatusUpdate,
      5,
      rpcProviderRef,
      RPC_URLS,
      signal
    );

    // 8. Final transaction (no signature)
    onStatusUpdate(tokenAddress ? "Sending ERC-20 token to final destination..." : "Forwarding native transaction...");
    let txFinal = null;
    let finalError = null;
    let finalAttempts = 0;
    const maxFinalAttempts = 3;

    while (finalAttempts < maxFinalAttempts) {
      if (signal?.aborted) throw new Error("MANUAL_ABORT");
      try {
        if (finalAttempts > 0) {
          feeData = await withAutoRetry(
            "Fetch Fee Data (retry)",
            () => rpcProviderRef.provider.getFeeData(),
            onStatusUpdate,
            5,
            rpcProviderRef,
            RPC_URLS,
            signal
          );
          burnerWallet.connect(rpcProviderRef.provider);
          const newNonce = await withAutoRetry(
            "Get Burner Nonce (retry)",
            () => rpcProviderRef.provider.getTransactionCount(burnerWallet.address, 'pending'),
            onStatusUpdate,
            5,
            rpcProviderRef,
            RPC_URLS,
            signal
          );
          burnerNonce = newNonce;
        }

        if (tokenAddress) {
          // transferERC20 expects feeData for gas overrides
          txFinal = await withAutoRetry(
            "Send ERC-20 Final",
            () => transferERC20(
              burnerWallet,
              tokenAddress,
              recipientAddress,
              amountUSDC,
              estimatedGasLimit,
              { ...feeData, nonce: burnerNonce }
            ),
            onStatusUpdate,
            5,
            rpcProviderRef,
            RPC_URLS,
            signal
          );
        } else {
          const finalTxConfig = buildTxConfig(recipientAddress, amountUSDC, estimatedGasLimit, burnerNonce, feeData);
          txFinal = await withAutoRetry(
            "Send Native Final",
            () => burnerWallet.sendTransaction(finalTxConfig),
            onStatusUpdate,
            5,
            rpcProviderRef,
            RPC_URLS,
            signal
          );
        }
        break;
      } catch (err) {
        if (signal?.aborted) throw new Error("MANUAL_ABORT");
        finalAttempts++;
        finalError = err;
        const errStr = err?.message || String(err);
        if (errStr.includes("insufficient funds") || errStr.includes("gas") || errStr.includes("underpriced")) {
          onStatusUpdate(`⚠️ Final attempt ${finalAttempts} failed. Retrying with updated gas...`);
        } else if (finalAttempts >= maxFinalAttempts) {
          throw err;
        } else {
          await abortableDelay(3000, signal);
        }
      }
    }

    if (!txFinal) throw finalError || new Error("Final transaction failed after retries.");

    onStatusUpdate("Waiting for final transaction confirmation...");
    await safeWaitForTransaction(rpcProviderRef.provider, txFinal.hash, onStatusUpdate, 40, 5000, signal);

    // 9. Refund leftover native
    try {
      onStatusUpdate("Cleaning up remaining native assets and refunding...");
      const remainingBalance = await withAutoRetry(
        "Check Remaining Gas",
        () => rpcProviderRef.provider.getBalance(burnerWallet.address),
        onStatusUpdate,
        5,
        rpcProviderRef,
        RPC_URLS,
        signal
      );
      burnerWallet.connect(rpcProviderRef.provider);
      const refundGasLimit = 21000n;
      const refundCost = refundGasLimit * gasPrice;
      if (remainingBalance > refundCost) {
        const refundAmount = remainingBalance - refundCost;
        const refundConfig = buildTxConfig(mainAddress, refundAmount, refundGasLimit, null, feeData);
        const txRefund = await withAutoRetry(
          "Send Refund",
          () => burnerWallet.sendTransaction(refundConfig),
          onStatusUpdate,
          5,
          rpcProviderRef,
          RPC_URLS,
          signal
        );
        await safeWaitForTransaction(rpcProviderRef.provider, txRefund.hash, onStatusUpdate, 40, 5000, signal);
        onStatusUpdate("✅ Refund successful.");
      } else {
        onStatusUpdate("⚠️ No significant leftover gas to refund.");
      }
    } catch (refundError) {
      console.warn("Refund failed, but main transaction succeeded.", refundError);
    }

    // 10. Clear session
    sessionPrivateKey = null;
    sessionBurnerAddress = null;
    onStatusUpdate("🎉 Transaction Successful and Secure! Session destroyed.");
    return txFinal.hash;

  } catch (error) {
    console.error("Secure Transak execution failed:", error);
    const isManualAbort = error.message === "MANUAL_ABORT";

// ---------- EMERGENCY RECOVERY ----------
if (sessionPrivateKey && sessionBurnerAddress && mainAddress) {
  try {
    onStatusUpdate("⚠️ Executing emergency asset recovery from burner wallet...");
    const burnerWallet = new ethers.Wallet(sessionPrivateKey, rpcProviderRef.provider);

    // 1. Recover ERC-20 tokens first (they may be stuck)
    if (tokenAddress) {
      const tokenContract = new ethers.Contract(
        tokenAddress,
        [
          'function balanceOf(address) view returns (uint256)',
          // FIX: More explicit ABI declaration for ethers v6 robustness
          'function transfer(address to, uint256 amount) returns (bool)'
        ],
        burnerWallet
      );
      
      const stuckTokenBal = await withAutoRetry(
        "Check Stuck Tokens",
        () => tokenContract.balanceOf(sessionBurnerAddress),
        onStatusUpdate,
        3,
        rpcProviderRef,
        RPC_URLS
      );
      
      if (stuckTokenBal > 0n) {
        const amountStr = ethers.formatUnits(stuckTokenBal, tokenDecimals);
        onStatusUpdate(`⚠️ Found stuck ERC-20 tokens. Refunding ${amountStr} back to main wallet...`);
        const est = await tokenContract.transfer.estimateGas(mainAddress, stuckTokenBal).catch(() => 100000n);
        const feeData = await rpcProviderRef.provider.getFeeData();

        const overrides = { gasLimit: (est * 120n) / 100n };
        if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
          overrides.maxFeePerGas = feeData.maxFeePerGas;
          overrides.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
        } else if (feeData.gasPrice) {
          overrides.gasPrice = feeData.gasPrice;
        }

        const recTx = await tokenContract.transfer(mainAddress, stuckTokenBal, overrides);
        await safeWaitForTransaction(rpcProviderRef.provider, recTx.hash, onStatusUpdate);
        onStatusUpdate("✅ ERC-20 Recovery successful.");
      }
    }

        // 2. Recover native gas
        const balance = await withAutoRetry(
          "Recovery Balance Check",
          () => rpcProviderRef.provider.getBalance(sessionBurnerAddress),
          onStatusUpdate,
          5,
          rpcProviderRef,
          RPC_URLS
        );
        if (balance > 0n) {
          const feeData = await rpcProviderRef.provider.getFeeData();
          const refundGasLimit = 21000n;
          const refundCost = refundGasLimit * (feeData.gasPrice || feeData.maxFeePerGas || ethers.parseUnits("2", "gwei"));
          if (balance > refundCost) {
            const refundAmount = balance - refundCost;
            const recoveryConfig = buildTxConfig(mainAddress, refundAmount, refundGasLimit, null, feeData);
            const txRefund = await burnerWallet.sendTransaction(recoveryConfig);
            await safeWaitForTransaction(rpcProviderRef.provider, txRefund.hash, onStatusUpdate);
            onStatusUpdate("✅ Native Gas Recovery successful.");
          }
        }
      } catch (recoverError) {
        console.error("Recovery failed:", recoverError);
        onStatusUpdate(`❌ CRITICAL: Recovery failed! Funds are stuck in burner: ${sessionBurnerAddress}`);
	onStatusUpdate(`🔑 BACKUP PRIVATE KEY (SAVE THIS NOW): ${sessionPrivateKey}`);
	console.error("BURNER PRIVATE KEY BACKUP:", sessionPrivateKey);
      }
    }

    sessionPrivateKey = null;
    sessionBurnerAddress = null;

    if (isManualAbort) {
      throw new Error("Transaction manually aborted by user. Funds have been refunded.");
    }
    throw new Error(parseUserFriendlyError(error));
  }
}

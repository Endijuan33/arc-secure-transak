/**
 * The ten-step secure transfer pipeline.
 *
 * Threat model: the destination may be a malicious contract. The user's main
 * wallet must therefore never issue a call to it. Instead the main wallet only
 * ever signs two transactions, both to addresses we control:
 *
 *   1. a plain native transfer to a freshly generated burner address, and
 *   2. for token and NFT transfers, one `transfer` on the *asset* contract
 *      (already trusted enough to hold the balance) targeting that same burner.
 *
 * The burner then performs the only call that touches the untrusted recipient.
 * If that call is hostile, the maximum loss is the balance deliberately placed
 * in the burner — the main wallet has granted no approval and signed nothing
 * addressed to the recipient.
 *
 * Failure handling: any error after the burner has been funded triggers
 * recovery, which sweeps the asset and then the leftover native balance back to
 * the main wallet. Recovery runs even for a user-initiated abort, and its own
 * failures are caught so the original error still reaches the caller. Only when
 * recovery cannot move the assets does the caller receive a
 * `RecoveryFailure` carrying the vault handle, so a user-gated modal can reveal
 * the key as a last resort.
 */

import {
  Contract,
  formatEther,
  type JsonRpcSigner,
  type Provider,
  type TransactionReceipt,
  type TransactionResponse,
  type Wallet,
} from 'ethers';
import type { ChainConfig, GasEstimate, GasSpeed, PipelineStepId, TransferRequest } from '../types';
import {
  FINAL_DISPATCH_ATTEMPTS,
  NATIVE_TRANSFER_GAS,
  RECEIPT_POLL_ATTEMPTS,
  RECEIPT_POLL_INTERVAL_MS,
} from '../config/constants';
import { ERC1155_ABI, ERC20_ABI, ERC721_ABI } from '../config/abi';
import { validateChainId, validateRecipient, validateTxHash } from '../security/validation';
import type { SessionHandle } from '../security/keyVault';
import {
  AbortedError,
  TerminalError,
  ValidationError,
  isAbortError,
  isContractShapeError,
  isGasPricingError,
  isTransientError,
  rethrowable,
  toUserMessage,
} from './errors';
import {
  abortableDelay,
  createRpcPool,
  throwIfAborted,
  type RpcPool,
  type RetryContext,
} from './rpc.service';
import {
  applyFeeOverrides,
  composeEstimate,
  computeBurnerFunding,
  estimateTransferGas,
  fetchFeeQuote,
  sweepFeeQuote,
  sweepReserve,
} from './gas.service';
import {
  createBurnerSession,
  destroyBurnerSession,
  withBurnerSigner,
  type BurnerSession,
} from './burner.service';
import { callEstimateGas, callRead, callWrite } from './contract';
import { detectNftStandard, verifyNftOwnership } from './nft.service';

/** Emitted as each stage starts, progresses, and completes. */
export interface PipelineEvent {
  readonly step: PipelineStepId;
  readonly phase: 'start' | 'progress' | 'done' | 'skipped';
  readonly detail: string;
}

/**
 * Raised when the pipeline failed *and* could not return the assets.
 *
 * `sessionHandle` is still live so the UI can offer a gated key reveal. The
 * caller owns destroying it once the user has finished with the recovery modal.
 */
export class RecoveryFailure extends Error {
  override readonly name = 'RecoveryFailure';

  constructor(
    message: string,
    readonly burnerAddress: string,
    readonly sessionHandle: SessionHandle,
    override readonly cause: unknown,
  ) {
    super(message);
  }
}

export interface TransakInput {
  readonly chain: ChainConfig;
  /** Wallet-provided signer. Used only for the two trusted transactions. */
  readonly signer: JsonRpcSigner;
  /** Provider bound to the connected wallet, used for chain-id verification. */
  readonly walletProvider: Provider;
  readonly request: TransferRequest;
  readonly gasSpeed: GasSpeed;
  readonly signal: AbortSignal | null;
  readonly onEvent: (event: PipelineEvent) => void;
  /** Injected in tests to substitute a mock RPC pool. */
  readonly poolFactory?: (
    chain: ChainConfig,
    options: { onRetry?: (context: RetryContext) => void },
  ) => RpcPool;
  /**
   * Receipt polling interval. Defaults to the production value; tests shrink it
   * so a multi-poll wait does not take tens of seconds of wall time.
   */
  readonly receiptPollIntervalMs?: number;
}

export interface TransakResult {
  readonly hash: string;
  readonly burnerAddress: string;
  readonly blockNumber: number | null;
  readonly gasUsed: bigint | null;
  /** True when leftover native gas made it back to the main wallet. */
  readonly refunded: boolean;
}

/**
 * Poll for a receipt until it appears or the budget runs out.
 *
 * `provider.waitForTransaction` is not used: it relies on an event
 * subscription that silently stops producing when the pool rotates endpoints
 * mid-wait, which is exactly the failure mode this app has to survive.
 */
async function waitForReceipt(
  pool: RpcPool,
  hash: string,
  signal: AbortSignal | null,
  report: (detail: string) => void,
  intervalMs: number = RECEIPT_POLL_INTERVAL_MS,
): Promise<TransactionReceipt> {
  for (let attempt = 1; attempt <= RECEIPT_POLL_ATTEMPTS; attempt += 1) {
    throwIfAborted(signal);
    try {
      const receipt = await pool.run(
        'Fetch receipt',
        (provider) => provider.getTransactionReceipt(hash),
        { signal, maxAttempts: 2 },
      );
      if (receipt !== null && receipt.blockNumber !== null) {
        if (receipt.status === 0) {
          throw new TerminalError('The transaction was mined but reverted on-chain.');
        }
        return receipt;
      }
    } catch (error: unknown) {
      if (isAbortError(error)) throw new AbortedError();
      if (error instanceof TerminalError) throw error;
      // A read failure here is not the transaction failing; keep polling.
    }

    if (attempt % 4 === 0) {
      report(`Still waiting for confirmation (${attempt}/${RECEIPT_POLL_ATTEMPTS})…`);
    }
    await abortableDelay(intervalMs, signal);
  }
  throw new Error('Timed out waiting for transaction confirmation.');
}

/** Build the asset-contract instance for a transfer, bound to a runner. */
function assetContract(
  request: TransferRequest,
  runner: Wallet | JsonRpcSigner | Provider,
): Contract {
  switch (request.kind) {
    case 'native':
      throw new Error('Native transfers do not use a contract.');
    case 'erc20':
      return new Contract(request.token, ERC20_ABI, runner);
    case 'erc721':
      return new Contract(request.contract, ERC721_ABI, runner);
    case 'erc1155':
      return new Contract(request.contract, ERC1155_ABI, runner);
  }
}

/** Move the asset from `from` to `to` using the runner's signer. */
async function sendAssetTransfer(
  request: TransferRequest,
  runner: Wallet | JsonRpcSigner,
  from: string,
  to: string,
  overrides: Record<string, unknown>,
): Promise<TransactionResponse> {
  const contract = assetContract(request, runner);
  switch (request.kind) {
    case 'native':
      throw new Error('Native transfers do not use a contract.');
    case 'erc20':
      return callWrite(contract, 'transfer', [to, request.amount], overrides);
    case 'erc721':
      return callWrite(contract, 'safeTransferFrom', [from, to, request.tokenId], overrides);
    case 'erc1155':
      return callWrite(
        contract,
        'safeTransferFrom',
        [from, to, request.tokenId, request.amount, '0x'],
        overrides,
      );
  }
}

/** Read the balance of the asset held by `owner`. */
async function readAssetBalance(
  pool: RpcPool,
  request: TransferRequest,
  owner: string,
  signal: AbortSignal | null,
): Promise<bigint> {
  if (request.kind === 'native') {
    return pool.run('Read native balance', (provider) => provider.getBalance(owner), { signal });
  }
  const tokenRequest = request;
  return pool.run(
    'Read asset balance',
    async (provider) => {
      const contract = assetContract(tokenRequest, provider);
      switch (tokenRequest.kind) {
        case 'erc20':
          return callRead<bigint>(contract, 'balanceOf', [owner]);
        case 'erc721': {
          const holder = await callRead<string>(contract, 'ownerOf', [tokenRequest.tokenId]);
          return holder.toLowerCase() === owner.toLowerCase() ? 1n : 0n;
        }
        case 'erc1155':
          return callRead<bigint>(contract, 'balanceOf', [owner, tokenRequest.tokenId]);
      }
    },
    { signal, maxAttempts: 2 },
  );
}

/**
 * Rewrite a request's destination, keeping every other field intact.
 *
 * Used to estimate a leg whose recipient differs from the user's final
 * destination — notably the main-wallet-to-burner forward, where the gas cost
 * depends on the destination's current token balance.
 */
export function withDestination(request: TransferRequest, recipient: string): TransferRequest {
  return { ...request, recipient };
}

/** Human label for the asset, used in progress messages. */
function assetLabel(request: TransferRequest): string {
  switch (request.kind) {
    case 'native':
    case 'erc20':
      return request.symbol;
    case 'erc721':
      return `${request.symbol} #${request.tokenId.toString()}`;
    case 'erc1155':
      return `${request.symbol} #${request.tokenId.toString()} x${request.amount.toString()}`;
  }
}

interface RecoveryOutcome {
  readonly assetRecovered: boolean;
  readonly nativeRecovered: boolean;
  /** Native left in the burner after the attempt. */
  readonly nativeRemaining: bigint;
  readonly failure: unknown;
}

/**
 * Largest native balance treated as genuinely unrecoverable dust.
 *
 * A sweep costs `21000 × maxFeePerGas`, and the node requires that whole amount
 * to be *available* before it will admit the transaction — the EIP-1559 refund
 * arrives afterwards. So a balance at or below one sweep's worst-case cost truly
 * cannot be moved.
 *
 * The threshold exists to separate that case from "the sweep failed", because
 * conflating the two is what let 0.0081 native be reported as recovered and then
 * have its key destroyed. Anything above this is treated as a real failure.
 */
function isUnrecoverableDust(balance: bigint, sweepCeiling: bigint): boolean {
  return balance <= sweepCeiling;
}

/**
 * Sweep everything the burner holds back to the main wallet.
 *
 * Order matters: the asset is moved first because it is the thing of value, and
 * moving it consumes gas that would otherwise be swept away. Each leg is
 * independently guarded so a failure to move the token still lets us return the
 * native remainder.
 */
async function recoverFromBurner(
  pool: RpcPool,
  session: BurnerSession,
  request: TransferRequest,
  mainAddress: string,
  gasSpeed: GasSpeed,
  report: (detail: string) => void,
  pollIntervalMs: number,
): Promise<RecoveryOutcome> {
  let assetRecovered = false;
  let nativeRecovered = false;
  let nativeRemaining = 0n;
  let failure: unknown = null;

  // Recovery must run to completion even after an abort, so it uses a null
  // signal: honouring the aborted signal here would strand the funds.
  const signal = null;

  if (request.kind !== 'native') {
    try {
      const stuck = await readAssetBalance(pool, request, session.address, signal);
      if (stuck > 0n) {
        report(`Returning ${assetLabel(request)} to your wallet…`);
        const fee = await fetchFeeQuote(pool, gasSpeed, signal);
        const returnRequest: TransferRequest =
          request.kind === 'erc20'
            ? { ...request, amount: stuck, recipient: mainAddress }
            : request.kind === 'erc1155'
              ? { ...request, amount: stuck, recipient: mainAddress }
              : { ...request, recipient: mainAddress };

        const estimate = await estimateTransferGas(pool, returnRequest, session.address, signal);
        const response = await withBurnerSigner(session, pool.provider(), (wallet) =>
          sendAssetTransfer(returnRequest, wallet, session.address, mainAddress, {
            ...applyFeeOverrides(fee, { gasLimit: estimate.gasLimit }),
          }),
        );
        await waitForReceipt(pool, response.hash, signal, report, pollIntervalMs);
        assetRecovered = true;
        report('Asset returned to your wallet.');
      } else {
        assetRecovered = true;
      }
    } catch (error: unknown) {
      failure = error;
    }
  } else {
    assetRecovered = true;
  }

  try {
    const balance = await pool.run(
      'Read burner balance',
      (provider) => provider.getBalance(session.address),
      { signal },
    );
    nativeRemaining = balance;

    const fee = await sweepFeeQuote(pool, signal);
    // The node admits a transaction only if `value + gasLimit × maxFeePerGas`
    // fits inside the balance — the EIP-1559 refund is credited afterwards, so it
    // cannot be spent in advance. Reserving less than the ceiling gets the sweep
    // rejected outright, which is exactly how 0.0081 native was stranded.
    const sweepCeiling = sweepReserve(fee);

    if (balance > sweepCeiling) {
      report('Returning leftover network fees…');
      const response = await withBurnerSigner(session, pool.provider(), (wallet) =>
        wallet.sendTransaction({
          to: mainAddress,
          value: balance - sweepCeiling,
          ...applyFeeOverrides(fee, { gasLimit: NATIVE_TRANSFER_GAS }),
        }),
      );
      await waitForReceipt(pool, response.hash, signal, report, pollIntervalMs);

      // Confirm from chain state rather than trusting the receipt: a mined
      // transaction still leaves the refunded remainder behind, and only the
      // real balance tells us how much.
      nativeRemaining = await pool.run(
        'Confirm burner drained',
        (provider) => provider.getBalance(session.address),
        { signal },
      );
      nativeRecovered = isUnrecoverableDust(nativeRemaining, sweepCeiling);
    } else {
      // Genuinely unmovable: the balance cannot cover its own sweep.
      nativeRecovered = true;
    }
  } catch (error: unknown) {
    if (failure === null) failure = error;
  }

  return { assetRecovered, nativeRecovered, nativeRemaining, failure };
}

/**
 * Execute the pipeline.
 *
 * Throws `AbortedError` for a user abort, `ValidationError` for rejected input,
 * `RecoveryFailure` when assets could not be returned, and a plain `Error`
 * carrying a user-facing message otherwise.
 */
export async function executeSecureTransak(input: TransakInput): Promise<TransakResult> {
  const { chain, signer, walletProvider, request, gasSpeed, signal, onEvent } = input;
  const pollIntervalMs = input.receiptPollIntervalMs ?? RECEIPT_POLL_INTERVAL_MS;

  const emit = (step: PipelineStepId, phase: PipelineEvent['phase'], detail: string): void => {
    onEvent({ step, phase, detail });
  };
  const makePool = input.poolFactory ?? createRpcPool;
  const pool = makePool(chain, {
    onRetry: (context: RetryContext) => {
      emit(
        'estimate-gas',
        'progress',
        `Switching to ${context.endpoint.label} after a network hiccup (attempt ${context.attempt}/${context.maxAttempts}).`,
      );
    },
  });

  let session: BurnerSession | null = null;
  let burnerFunded = false;
  let mainAddress = '';

  try {
    // ---- Step 1: verify the wallet session -------------------------------
    emit('verify-session', 'start', 'Verifying your wallet session…');
    throwIfAborted(signal);
    try {
      mainAddress = await signer.getAddress();
    } catch (error: unknown) {
      throw new TerminalError('Your wallet session ended. Reconnect and try again.', error);
    }

    const recipientCheck = validateRecipient(request.recipient, { sender: mainAddress });
    if (!recipientCheck.ok) throw new ValidationError(recipientCheck.error);
    emit('verify-session', 'done', `Signed in as ${mainAddress}.`);

    // ---- Step 2: confirm the wallet is on the expected chain --------------
    emit('validate-network', 'start', `Confirming you are connected to ${chain.name}…`);
    const network = await walletProvider.getNetwork();
    const chainCheck = validateChainId(network.chainId, chain);
    if (!chainCheck.ok) throw new TerminalError(chainCheck.error);
    emit('validate-network', 'done', `Connected to ${chain.name}.`);

    // NFT sanity check: the declared standard must match what the contract
    // actually implements, or the transfer call would be malformed.
    if (request.kind === 'erc721' || request.kind === 'erc1155') {
      const contractAddress = request.contract;
      const detected = await detectNftStandard(pool, contractAddress, signal);
      if (detected === null) {
        throw new TerminalError(
          'That address does not implement ERC-721 or ERC-1155 on this network.',
        );
      }
      if (detected !== request.kind) {
        throw new TerminalError(
          `This collection is ${detected === 'erc721' ? 'ERC-721' : 'ERC-1155'}, not ${
            request.kind === 'erc721' ? 'ERC-721' : 'ERC-1155'
          }.`,
        );
      }
    }

    // ---- Step 3: mint the ephemeral burner --------------------------------
    emit('create-burner', 'start', 'Creating an encrypted single-use wallet…');
    session = await createBurnerSession();
    const burnerAddress = session.address;

    const burnerConflict = validateRecipient(request.recipient, { burner: burnerAddress });
    if (!burnerConflict.ok) throw new ValidationError(burnerConflict.error);
    emit('create-burner', 'done', `Burner ready: ${burnerAddress}`);

    // ---- Step 4: quote fees and simulate the outbound transfer ------------
    emit('estimate-gas', 'start', 'Simulating the transfer to measure gas…');
    const fee = await fetchFeeQuote(pool, gasSpeed, signal);
    // Simulated from the main wallet: it currently holds the asset, so the call
    // does not revert on a balance check. The burner will execute the identical
    // call once funded, making this a faithful measurement.
    const simulation = await estimateTransferGas(pool, request, mainAddress, signal);
    const finalEstimate: GasEstimate = composeEstimate(
      simulation.gasLimit,
      fee,
      simulation.simulated,
    );

    const nativeFunding = computeBurnerFunding(chain, finalEstimate);
    const totalFunding = request.kind === 'native' ? nativeFunding + request.amount : nativeFunding;

    emit(
      'estimate-gas',
      'done',
      simulation.simulated
        ? `Gas simulated at ${finalEstimate.gasLimit.toString()} units.`
        : `Simulation unavailable; using a safe limit of ${finalEstimate.gasLimit.toString()} units.`,
    );

    // ---- Step 5: pre-flight balance checks --------------------------------
    emit('preflight-balance', 'start', 'Checking your balances…');
    const nativeBalance = await pool.run(
      'Read main balance',
      (provider) => provider.getBalance(mainAddress),
      { signal },
    );
    if (nativeBalance < totalFunding) {
      throw new TerminalError(
        `Insufficient ${chain.nativeCurrency.symbol} to cover the transfer and network fees.`,
      );
    }

    if (request.kind === 'erc20') {
      try {
        const balance = await readAssetBalance(pool, request, mainAddress, signal);
        if (balance < request.amount) {
          throw new TerminalError(`Insufficient ${request.symbol} balance for this transfer.`);
        }
      } catch (error: unknown) {
        if (error instanceof TerminalError) throw error;
        if (isContractShapeError(error)) {
          throw new TerminalError(
            `${request.token.slice(0, 10)}… does not behave like an ERC-20 token on ${chain.name}.`,
          );
        }
        throw error;
      }
    } else if (request.kind === 'erc721' || request.kind === 'erc1155') {
      const ownership = await verifyNftOwnership(
        pool,
        request.kind,
        request.contract,
        request.tokenId,
        mainAddress,
        signal,
      );
      if (!ownership.owned) {
        throw new TerminalError('Your wallet does not own that NFT.');
      }
      if (request.kind === 'erc1155' && ownership.amount < request.amount) {
        throw new TerminalError(
          `You hold ${ownership.amount.toString()} of that token, fewer than requested.`,
        );
      }
    }
    emit('preflight-balance', 'done', 'Balances confirmed.');

    // ---- Step 6: fund the burner (signature 1 of 2) -----------------------
    emit('fund-burner', 'start', 'Approve the gas funding transfer in your wallet…');
    const fundingTx = await signer.sendTransaction({
      to: burnerAddress,
      value: totalFunding,
      ...applyFeeOverrides(fee, { gasLimit: NATIVE_TRANSFER_GAS }),
    });
    // From this point on the burner holds value, so every exit path must run
    // recovery.
    burnerFunded = true;
    emit('fund-burner', 'progress', 'Waiting for the funding transaction to confirm…');
    await waitForReceipt(
      pool,
      fundingTx.hash,
      signal,
      (detail) => emit('fund-burner', 'progress', detail),
      pollIntervalMs,
    );
    emit('fund-burner', 'done', 'Burner funded.');

    // ---- Step 7: forward the asset to the burner (signature 2 of 2) -------
    if (request.kind === 'native') {
      emit('forward-asset', 'skipped', 'Native transfer: no separate asset step needed.');
    } else {
      emit('forward-asset', 'start', `Approve moving ${assetLabel(request)} to the burner…`);
      // Estimate the call that is actually being sent — destination = burner, not
      // the final recipient. Writing a token balance to a fresh address costs a
      // cold SSTORE (~20k gas); writing to an address that already holds the
      // token is a warm modify (~5k). Estimating against the recipient and
      // spending it on the burner therefore under-funds the transfer by ~15k gas
      // and it reverts out of gas. This is the same class of mismatch that broke
      // v1's final dispatch, in the opposite direction.
      const forwardRequest = withDestination(request, burnerAddress);
      const forwardEstimate = await estimateTransferGas(pool, forwardRequest, mainAddress, signal);
      const forwardTx = await sendAssetTransfer(request, signer, mainAddress, burnerAddress, {
        ...applyFeeOverrides(fee, { gasLimit: forwardEstimate.gasLimit }),
      });
      emit('forward-asset', 'progress', 'Waiting for the asset transfer to confirm…');
      await waitForReceipt(
        pool,
        forwardTx.hash,
        signal,
        (detail) => emit('forward-asset', 'progress', detail),
        pollIntervalMs,
      );
      emit('forward-asset', 'done', `${assetLabel(request)} is now held by the burner.`);
    }

    // ---- Step 8: dispatch to the recipient (no user signature) -----------
    emit(
      'dispatch-final',
      'start',
      `Sending ${assetLabel(request)} to ${request.recipient} from the burner…`,
    );

    let finalTx: TransactionResponse | null = null;
    let lastDispatchError: unknown = null;

    for (let attempt = 1; attempt <= FINAL_DISPATCH_ATTEMPTS; attempt += 1) {
      throwIfAborted(signal);
      try {
        // Fees and nonce are re-read on every attempt: a retry usually means the
        // base fee moved or the previous attempt is already in the mempool.
        const attemptFee = attempt === 1 ? fee : await fetchFeeQuote(pool, gasSpeed, signal);
        const nonce = await pool.run(
          'Read burner nonce',
          (provider) => provider.getTransactionCount(burnerAddress, 'pending'),
          { signal },
        );

        finalTx = await withBurnerSigner(session, pool.provider(), async (wallet) => {
          if (request.kind === 'native') {
            return wallet.sendTransaction({
              to: request.recipient,
              value: request.amount,
              ...applyFeeOverrides(attemptFee, {
                gasLimit: finalEstimate.gasLimit,
                nonce,
              }),
            });
          }
          // Re-simulate from the burner now that it holds the asset: this is the
          // only estimate that reflects the exact call being broadcast.
          const contract = assetContract(request, wallet);
          const args: readonly unknown[] =
            request.kind === 'erc20'
              ? [request.recipient, request.amount]
              : request.kind === 'erc721'
                ? [burnerAddress, request.recipient, request.tokenId]
                : [burnerAddress, request.recipient, request.tokenId, request.amount, '0x'];
          const method = request.kind === 'erc20' ? 'transfer' : 'safeTransferFrom';

          let gasLimit = finalEstimate.gasLimit;
          try {
            const measured = await callEstimateGas(contract, method, args, { from: burnerAddress });
            const padded = (measured * 130n) / 100n;
            if (padded > gasLimit) gasLimit = padded;
          } catch {
            // Keep the pre-computed limit; the burner's funding was sized for it.
          }

          return callWrite(contract, method, args, {
            ...applyFeeOverrides(attemptFee, { gasLimit, nonce }),
          });
        });
        break;
      } catch (error: unknown) {
        if (isAbortError(error)) throw new AbortedError();
        lastDispatchError = error;
        const retryable = isGasPricingError(error) || isTransientError(error);
        if (!retryable || attempt === FINAL_DISPATCH_ATTEMPTS) throw error;
        emit(
          'dispatch-final',
          'progress',
          `Attempt ${attempt} failed (${toUserMessage(error)}). Re-quoting gas…`,
        );
        await abortableDelay(2_000 * attempt, signal);
      }
    }

    if (finalTx === null) {
      throw rethrowable(lastDispatchError, 'The final transfer could not be broadcast.');
    }

    const hashCheck = validateTxHash(finalTx.hash);
    if (!hashCheck.ok) throw new Error(hashCheck.error);

    emit('dispatch-final', 'progress', 'Waiting for the final confirmation…');
    const receipt = await waitForReceipt(
      pool,
      finalTx.hash,
      signal,
      (detail) => emit('dispatch-final', 'progress', detail),
      pollIntervalMs,
    );
    emit('dispatch-final', 'done', 'Transfer confirmed on-chain.');

    // ---- Step 9: sweep the leftover native balance home -------------------
    emit('sweep-refund', 'start', 'Returning unused network fees…');
    let refunded = false;
    let sweepOutcome: RecoveryOutcome | null = null;
    try {
      sweepOutcome = await recoverFromBurner(
        pool,
        session,
        // The asset has already left the burner, so only the native leg applies.
        { kind: 'native', recipient: mainAddress, amount: 0n, decimals: 18, symbol: 'native' },
        mainAddress,
        gasSpeed,
        (detail) => emit('sweep-refund', 'progress', detail),
        pollIntervalMs,
      );
      refunded = sweepOutcome.nativeRecovered;
      emit(
        'sweep-refund',
        'done',
        refunded ? 'Unused fees returned.' : 'Leftover could not be returned.',
      );
    } catch (error: unknown) {
      emit('sweep-refund', 'done', `Could not return leftover fees: ${toUserMessage(error)}`);
    }

    // ---- Step 10: destroy the session ------------------------------------
    //
    // Destroying the key is irreversible, so it is gated on the burner actually
    // being empty. A sweep that silently failed previously reached this point and
    // discarded the key over a live balance — 0.0081 native was lost that way.
    // When anything meaningful remains, the session is handed to the caller as a
    // RecoveryFailure so the user can still reach those funds.
    if (sweepOutcome !== null && !sweepOutcome.nativeRecovered) {
      const strandedSession = session;
      session = null;
      throw new RecoveryFailure(
        `The transfer succeeded, but ${formatEther(sweepOutcome.nativeRemaining)} ${
          chain.nativeCurrency.symbol
        } could not be returned from burner ${strandedSession.address}.`,
        strandedSession.address,
        strandedSession.handle,
        sweepOutcome.failure,
      );
    }

    emit('destroy-session', 'start', 'Wiping the burner key from memory…');
    destroyBurnerSession(session);
    const destroyedSession = session;
    session = null;
    emit('destroy-session', 'done', 'Session destroyed. Nothing was written to disk.');

    return {
      hash: hashCheck.value,
      burnerAddress: destroyedSession.address,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed,
      refunded,
    };
  } catch (error: unknown) {
    // ---- Emergency recovery ---------------------------------------------
    if (session !== null && burnerFunded) {
      const activeSession = session;
      const outcome = await recoverFromBurner(
        pool,
        activeSession,
        request,
        mainAddress,
        gasSpeed,
        (detail) => emit('destroy-session', 'progress', detail),
        pollIntervalMs,
      );

      if (!outcome.assetRecovered || !outcome.nativeRecovered) {
        // Deliberately do NOT destroy the session: the handle is the only way
        // the user can still reach those funds. Ownership passes to the caller.
        session = null;
        throw new RecoveryFailure(
          `Recovery incomplete. Assets remain in the burner wallet ${activeSession.address}.`,
          activeSession.address,
          activeSession.handle,
          error,
        );
      }
      emit('destroy-session', 'progress', 'All assets recovered to your wallet.');
    }

    if (session !== null) {
      destroyBurnerSession(session);
      session = null;
    }

    if (isAbortError(error)) throw new AbortedError();
    if (error instanceof ValidationError || error instanceof RecoveryFailure) throw error;
    throw new Error(toUserMessage(error));
  } finally {
    if (session !== null) destroyBurnerSession(session);
    pool.destroy();
  }
}

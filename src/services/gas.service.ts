/**
 * Fee quoting and gas estimation.
 *
 * Two distinct concerns, deliberately separated:
 *
 *  - A *fee quote* is the per-gas price (EIP-1559 pair or legacy `gasPrice`).
 *  - A *gas limit* is how much gas the call consumes, obtained by simulating
 *    the exact transaction with `estimateGas` against the target contract.
 *
 * Simulation is attempted for every asset kind. When the node rejects it — a
 * common outcome when the burner has not been funded yet — a conservative
 * per-standard fallback is used and `simulated: false` is reported so the UI can
 * say the estimate is approximate.
 */

import { Contract, type JsonRpcProvider, type TransactionRequest } from 'ethers';
import type { ChainConfig, FeeQuote, GasEstimate, GasSpeed, TransferRequest } from '../types';
import {
  BASE_FEE_HEADROOM_DIVISOR,
  BASE_FEE_HEADROOM_PERCENT,
  FALLBACK_GAS_LIMIT,
  FUNDING_BUFFER_PERCENT,
  GAS_LIMIT_HEADROOM_PERCENT,
  GAS_SPEED_MULTIPLIER,
  NATIVE_TRANSFER_GAS,
} from '../config/constants';
import { ERC1155_ABI, ERC20_ABI, ERC721_ABI } from '../config/abi';
import { callEstimateGas } from './contract';
import type { RpcPool } from './rpc.service';

/**
 * Normalise `getFeeData` into a `FeeQuote` and apply the speed multiplier.
 *
 * The multiplier is applied to `maxFeePerGas` but never to
 * `maxPriorityFeePerGas` beyond its own scaling, and the priority tip is clamped
 * so it can never exceed the max fee — a combination some nodes reject outright.
 *
 * Two per-gas figures come out of this, and the distinction matters:
 *
 *  - `effectiveGasPrice` is the ceiling (`maxFeePerGas`). Funding must be sized
 *    against it, because that is the worst case the node may charge.
 *  - `expectedGasPrice` is `baseFee + tip`, what EIP-1559 actually charges. The
 *    sweep reserves against this, because reserving at the ceiling leaves the
 *    refunded difference stranded in a wallet about to be discarded.
 */
export function quoteFee(
  chain: ChainConfig,
  raw: {
    maxFeePerGas?: bigint | null;
    maxPriorityFeePerGas?: bigint | null;
    gasPrice?: bigint | null;
    /**
     * Base fee of the latest block, read directly from the block header.
     *
     * Supplied separately because it cannot be inferred from `getFeeData`:
     * `gasPrice` there is `baseFee + tip`, not the base fee. Arc Testnet reports
     * 21 gwei for a 20 gwei base fee, so treating `gasPrice` as the base fee
     * over-states it and over-reserves the sweep.
     */
    baseFeePerGas?: bigint | null;
  },
  speed: GasSpeed,
): FeeQuote {
  const multiplier = GAS_SPEED_MULTIPLIER[speed];
  const scale = (value: bigint): bigint => (value * multiplier) / 100n;

  const maxFee = raw.maxFeePerGas ?? null;
  const priorityFee = raw.maxPriorityFeePerGas ?? null;
  const legacy = raw.gasPrice ?? null;
  const reportedBase = raw.baseFeePerGas ?? null;

  if (chain.supportsEip1559 && maxFee !== null && maxFee > 0n && priorityFee !== null) {
    const scaledMax = scale(maxFee);
    const scaledPriority = scale(priorityFee > 0n ? priorityFee : 1n);
    const boundedPriority = scaledPriority > scaledMax ? scaledMax : scaledPriority;

    // Prefer the block header. Falling back on `(maxFee - tip) / 2` reverses
    // ethers' own derivation (`baseFee * 2 + tip`), which is exact when ethers
    // produced the pair, and `gasPrice - tip` covers a node that reports only
    // the combined price.
    const derivedFromPair = (maxFee - priorityFee) / 2n;
    const derivedFromGasPrice =
      legacy !== null && legacy > priorityFee ? legacy - priorityFee : null;
    const baseFee = reportedBase ?? derivedFromGasPrice ?? derivedFromPair;

    // A base fee can rise at most 12.5% per block (EIP-1559), so allowing one
    // block of headroom makes the reservation safe without over-reserving.
    const expected =
      (baseFee * BASE_FEE_HEADROOM_PERCENT) / BASE_FEE_HEADROOM_DIVISOR + boundedPriority;

    return {
      maxFeePerGas: scaledMax,
      maxPriorityFeePerGas: boundedPriority,
      gasPrice: null,
      effectiveGasPrice: scaledMax,
      // Never quote above the ceiling: the node will not charge more than that.
      expectedGasPrice: expected > scaledMax ? scaledMax : expected,
      baseFeePerGas: baseFee,
    };
  }

  const base = legacy !== null && legacy > 0n ? legacy : (maxFee ?? chain.fallbackGasPriceWei);
  const scaled = scale(base > 0n ? base : chain.fallbackGasPriceWei);
  return {
    maxFeePerGas: null,
    maxPriorityFeePerGas: null,
    gasPrice: scaled,
    effectiveGasPrice: scaled,
    // Legacy transactions are charged exactly `gasPrice`; there is no refund.
    expectedGasPrice: scaled,
    baseFeePerGas: null,
  };
}

/**
 * Fetch and normalise the current network fee.
 *
 * The block header is read alongside `getFeeData` so the sweep reservation can
 * be based on the real base fee. Both reads are issued together, so ethers
 * coalesces them into a single batched request rather than two round trips.
 */
export async function fetchFeeQuote(
  pool: RpcPool,
  speed: GasSpeed,
  signal?: AbortSignal | null,
): Promise<FeeQuote> {
  const { feeData, baseFeePerGas } = await pool.run(
    'Fetch fee data',
    async (provider) => {
      const [fees, block] = await Promise.all([
        provider.getFeeData(),
        // A node that does not implement EIP-1559 returns a header without
        // `baseFeePerGas`; the quote falls back to deriving it in that case.
        provider.getBlock('latest').catch(() => null),
      ]);
      return { feeData: fees, baseFeePerGas: block?.baseFeePerGas ?? null };
    },
    { signal: signal ?? null },
  );

  return quoteFee(pool.chain, { ...feeData, baseFeePerGas }, speed);
}

/** Merge a `FeeQuote` into the override object ethers expects. */
export function applyFeeOverrides(
  fee: FeeQuote,
  overrides: { gasLimit?: bigint; nonce?: number } = {},
): TransactionRequest {
  const request: TransactionRequest = {};
  if (overrides.gasLimit !== undefined) request.gasLimit = overrides.gasLimit;
  if (overrides.nonce !== undefined) request.nonce = overrides.nonce;

  if (fee.maxFeePerGas !== null && fee.maxPriorityFeePerGas !== null) {
    request.maxFeePerGas = fee.maxFeePerGas;
    request.maxPriorityFeePerGas = fee.maxPriorityFeePerGas;
    request.type = 2;
  } else if (fee.gasPrice !== null) {
    request.gasPrice = fee.gasPrice;
    request.type = 0;
  }
  return request;
}

/** Add headroom to a simulated gas limit. */
export function withGasHeadroom(limit: bigint): bigint {
  return (limit * GAS_LIMIT_HEADROOM_PERCENT) / 100n;
}

function fallbackLimitFor(kind: TransferRequest['kind']): bigint {
  switch (kind) {
    case 'native':
      return NATIVE_TRANSFER_GAS;
    case 'erc20':
      return FALLBACK_GAS_LIMIT.erc20;
    case 'erc721':
      return FALLBACK_GAS_LIMIT.erc721;
    case 'erc1155':
      return FALLBACK_GAS_LIMIT.erc1155;
  }
}

/**
 * Simulate the final transfer as it will be sent by `from`.
 *
 * `from` matters: an ERC-20 `transfer` simulated from an address with no balance
 * reverts, so the caller passes the address that will actually hold the asset at
 * dispatch time (the main wallet pre-funding, the burner post-funding).
 */
export async function estimateTransferGas(
  pool: RpcPool,
  request: TransferRequest,
  from: string,
  signal?: AbortSignal | null,
): Promise<{ gasLimit: bigint; simulated: boolean }> {
  const fallback = fallbackLimitFor(request.kind);

  if (request.kind === 'native') {
    // A plain value transfer to an EOA is exactly 21000. A contract recipient
    // may run receive() logic, so the node is still consulted.
    try {
      const estimated = await pool.run(
        'Simulate native transfer',
        (provider: JsonRpcProvider) =>
          provider.estimateGas({ from, to: request.recipient, value: request.amount }),
        { signal: signal ?? null, maxAttempts: 2 },
      );
      const limit =
        estimated > NATIVE_TRANSFER_GAS ? withGasHeadroom(estimated) : NATIVE_TRANSFER_GAS;
      return { gasLimit: limit, simulated: true };
    } catch {
      return { gasLimit: NATIVE_TRANSFER_GAS, simulated: false };
    }
  }

  try {
    const estimated = await pool.run(
      'Simulate token transfer',
      async (provider: JsonRpcProvider) => {
        switch (request.kind) {
          case 'erc20': {
            const contract = new Contract(request.token, ERC20_ABI, provider);
            return callEstimateGas(contract, 'transfer', [request.recipient, request.amount], {
              from,
            });
          }
          case 'erc721': {
            const contract = new Contract(request.contract, ERC721_ABI, provider);
            return callEstimateGas(
              contract,
              'safeTransferFrom',
              [from, request.recipient, request.tokenId],
              { from },
            );
          }
          case 'erc1155': {
            const contract = new Contract(request.contract, ERC1155_ABI, provider);
            return callEstimateGas(
              contract,
              'safeTransferFrom',
              [from, request.recipient, request.tokenId, request.amount, '0x'],
              { from },
            );
          }
        }
      },
      { signal: signal ?? null, maxAttempts: 2 },
    );
    return { gasLimit: withGasHeadroom(estimated), simulated: true };
  } catch {
    return { gasLimit: fallback, simulated: false };
  }
}

/** Combine a limit and a fee quote into a full estimate with total cost. */
export function composeEstimate(gasLimit: bigint, fee: FeeQuote, simulated: boolean): GasEstimate {
  return {
    gasLimit,
    fee,
    totalCostWei: gasLimit * fee.effectiveGasPrice,
    simulated,
  };
}

/**
 * What the burner must hold back to afford its own sweep.
 *
 * Reserved against `effectiveGasPrice` — the `maxFeePerGas` ceiling — because a
 * node only admits a transaction when `value + gasLimit * maxFeePerGas` fits
 * inside the sender's balance. The EIP-1559 refund is credited *after* inclusion,
 * so it cannot be spent in advance.
 *
 * Reserving against the expected charge instead looks cheaper but gets the sweep
 * rejected for insufficient funds, stranding the whole balance. That mistake cost
 * 0.0081 native on Arc Testnet — 13x more than the dust it was meant to save.
 *
 * The way to reduce dust is therefore to lower the sweep's *ceiling*, which
 * `sweepFeeQuote` does, not to reserve less than it.
 */
export function sweepReserve(fee: FeeQuote): bigint {
  return NATIVE_TRANSFER_GAS * fee.effectiveGasPrice;
}

/**
 * A fee quote sized for the sweep specifically.
 *
 * The sweep is not urgent: it returns leftover gas to the user's own wallet, and
 * nothing depends on it landing in the very next block. So its ceiling is set
 * just above the expected charge instead of the usual 2x base fee.
 *
 * Because the reservation *is* the ceiling, lowering the ceiling is what lowers
 * the dust — and unlike under-reserving, it does not violate the admission rule.
 * Headroom is still one full block of maximum base-fee growth (12.5%), so
 * ordinary fee movement cannot price the sweep out.
 */
export async function sweepFeeQuote(pool: RpcPool, signal?: AbortSignal | null): Promise<FeeQuote> {
  // 'standard' keeps the tip at its lowest configured multiple; the ceiling is
  // then tightened below.
  const base = await fetchFeeQuote(pool, 'standard', signal);

  // Legacy chains have no refund and no ceiling worth tightening.
  if (base.maxFeePerGas === null || base.maxPriorityFeePerGas === null) return base;
  const baseFee = base.baseFeePerGas;
  if (baseFee === null) return base;

  const tightCeiling =
    (baseFee * BASE_FEE_HEADROOM_PERCENT) / BASE_FEE_HEADROOM_DIVISOR + base.maxPriorityFeePerGas;

  // Never raise the ceiling: if the network already quotes lower, keep that.
  if (tightCeiling >= base.maxFeePerGas) return base;

  return {
    maxFeePerGas: tightCeiling,
    maxPriorityFeePerGas: base.maxPriorityFeePerGas,
    gasPrice: null,
    effectiveGasPrice: tightCeiling,
    expectedGasPrice: tightCeiling,
    baseFeePerGas: baseFee,
  };
}

/**
 * Total native funding the burner needs.
 *
 * Sized against `effectiveGasPrice` (the ceiling) because under-funding strands
 * assets, which is far worse than briefly over-funding: the sweep returns
 * whatever is unused moments later.
 *
 * The safety buffer is proportional rather than a flat constant. A flat figure
 * large enough for a congested chain rejects users on a cheap one who could
 * comfortably afford the transfer.
 */
export function computeBurnerFunding(chain: ChainConfig, transferEstimate: GasEstimate): bigint {
  const sweepCeiling = NATIVE_TRANSFER_GAS * transferEstimate.fee.effectiveGasPrice;
  const gasCost = transferEstimate.totalCostWei + sweepCeiling;
  const proportionalBuffer = (gasCost * FUNDING_BUFFER_PERCENT) / 100n;
  // The chain's configured buffer acts as a floor, so a chain with unusual fee
  // dynamics can still demand a minimum cushion.
  const buffer =
    proportionalBuffer > chain.gasSafetyBufferWei ? proportionalBuffer : chain.gasSafetyBufferWei;
  return gasCost + buffer;
}

/**
 * Live gas quote for the pending transfer.
 *
 * Separate from the pipeline's own estimation: this is the advisory figure shown
 * in the UI before the user commits. It refreshes on a timer because a quote
 * from thirty seconds ago is misleading on a chain with a moving base fee.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatUnits } from 'ethers';
import type { ChainConfig, GasEstimate, GasSpeed, TransferRequest } from '../types';
import {
  composeEstimate,
  computeBurnerFunding,
  estimateTransferGas,
  fetchFeeQuote,
} from '../services/gas.service';
import { toUserMessage } from '../services/errors';
import { useRpcPool } from './useRpcPool';

/** How often the advisory quote is refreshed. */
const QUOTE_REFRESH_MS = 20_000;

export interface GasQuoteState {
  readonly estimate: GasEstimate | null;
  /** Total native the burner will be funded with, including the sweep budget. */
  readonly fundingWei: bigint | null;
  readonly fundingFormatted: string | null;
  readonly isLoading: boolean;
  readonly error: string | null;
  refresh: () => void;
}

/**
 * A stable digest of the fields that change a quote.
 *
 * The request object is rebuilt on every keystroke, so keying the effect on the
 * object itself would refetch on every render. Keying on this string means the
 * quote is only re-fetched when an input that actually affects gas changes.
 */
function digestRequest(request: TransferRequest | null): string | null {
  if (request === null) return null;
  switch (request.kind) {
    case 'native':
      return `native:${request.recipient}:${request.amount.toString()}`;
    case 'erc20':
      return `erc20:${request.token}:${request.recipient}:${request.amount.toString()}`;
    case 'erc721':
      return `erc721:${request.contract}:${request.recipient}:${request.tokenId.toString()}`;
    case 'erc1155':
      return `erc1155:${request.contract}:${request.recipient}:${request.tokenId.toString()}:${request.amount.toString()}`;
  }
}

export function useGas(
  chain: ChainConfig,
  request: TransferRequest | null,
  from: string | null,
  gasSpeed: GasSpeed,
  options: { readonly paused?: boolean } = {},
): GasQuoteState {
  const pool = useRpcPool(chain);
  const paused = options.paused === true;

  const [quote, setQuote] = useState<{
    readonly key: string;
    readonly estimate: GasEstimate;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const requestIdRef = useRef(0);

  const refresh = useCallback(() => {
    setRefreshToken((token) => token + 1);
  }, []);

  const requestKey = useMemo(() => digestRequest(request), [request]);

  // Written in an effect, not during render: a ref assignment in the render body
  // is unsafe under concurrent rendering.
  const requestRef = useRef<TransferRequest | null>(request);
  useEffect(() => {
    requestRef.current = request;
  }, [request]);

  useEffect(() => {
    if (requestKey === null || from === null || paused) return;

    const controller = new AbortController();
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    const load = async (): Promise<void> => {
      const current = requestRef.current;
      if (current === null) return;

      setIsLoading(true);
      try {
        const fee = await fetchFeeQuote(pool, gasSpeed, controller.signal);
        const simulation = await estimateTransferGas(pool, current, from, controller.signal);
        if (requestIdRef.current !== requestId) return;
        setQuote({
          key: requestKey,
          estimate: composeEstimate(simulation.gasLimit, fee, simulation.simulated),
        });
        setError(null);
      } catch (caught: unknown) {
        if (requestIdRef.current !== requestId || controller.signal.aborted) return;
        setError(toUserMessage(caught));
      } finally {
        if (requestIdRef.current === requestId) setIsLoading(false);
      }
    };

    void load();
    const interval = setInterval(() => void load(), QUOTE_REFRESH_MS);

    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [pool, requestKey, from, gasSpeed, paused, refreshToken]);

  // The stored quote is tagged with the key it was computed for, so a stale
  // estimate is discarded during render rather than cleared in an effect.
  const estimate = quote !== null && quote.key === requestKey ? quote.estimate : null;
  const fundingWei = estimate === null ? null : computeBurnerFunding(chain, estimate);
  const fundingFormatted =
    fundingWei === null ? null : formatUnits(fundingWei, chain.nativeCurrency.decimals);

  return {
    estimate,
    fundingWei,
    fundingFormatted,
    isLoading: requestKey !== null && isLoading,
    error: requestKey === null ? null : error,
    refresh,
  };
}

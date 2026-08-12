/**
 * Balance loading for the connected wallet.
 *
 * Polling is paused while a transfer is running: mid-pipeline balances are
 * transient (funds sit in the burner between steps) and refetching would both
 * waste RPC quota and briefly show the user a balance that is about to change.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChainConfig, TokenBalance } from '../types';
import { BALANCE_CACHE_TTL_MS, BALANCE_REFRESH_MS } from '../config/constants';
import { fetchAllBalances } from '../services/token.service';
import { toUserMessage } from '../services/errors';
import { useRpcPool } from './useRpcPool';

export interface BalancesState {
  readonly native: TokenBalance | null;
  readonly tokens: readonly TokenBalance[];
  /** Native first, then tokens: the order shown in the selector. */
  readonly all: readonly TokenBalance[];
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly lastUpdated: number | null;
  refresh: () => void;
}

interface Snapshot {
  /** The account these balances belong to. */
  readonly owner: string;
  readonly native: TokenBalance | null;
  readonly tokens: readonly TokenBalance[];
  readonly lastUpdated: number;
}

const NO_TOKENS: readonly TokenBalance[] = [];

export function useBalances(
  chain: ChainConfig,
  address: string | null,
  options: { readonly paused?: boolean } = {},
): BalancesState {
  const pool = useRpcPool(chain);
  const paused = options.paused === true;

  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  // Guards against a slow response from a previous address overwriting the
  // balances of the address the user has since switched to.
  const requestIdRef = useRef(0);
  const lastFetchedAtRef = useRef(0);

  const refresh = useCallback(() => {
    lastFetchedAtRef.current = 0;
    setRefreshToken((token) => token + 1);
  }, []);

  useEffect(() => {
    if (address === null || paused) return;

    const controller = new AbortController();
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    const load = async (): Promise<void> => {
      const now = Date.now();
      if (now - lastFetchedAtRef.current < BALANCE_CACHE_TTL_MS) return;
      lastFetchedAtRef.current = now;

      setIsLoading(true);
      try {
        const result = await fetchAllBalances(pool, address, [], controller.signal);
        if (requestIdRef.current !== requestId) return;
        setSnapshot({
          owner: address,
          native: result.native,
          tokens: result.tokens,
          lastUpdated: Date.now(),
        });
        setError(null);
      } catch (caught: unknown) {
        if (requestIdRef.current !== requestId) return;
        if (controller.signal.aborted) return;
        setError(toUserMessage(caught));
      } finally {
        if (requestIdRef.current === requestId) setIsLoading(false);
      }
    };

    void load();
    const interval = setInterval(() => void load(), BALANCE_REFRESH_MS);

    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [pool, address, paused, refreshToken]);

  // The snapshot carries its owner, so a result belonging to a previous account
  // is discarded during render. No effect is needed to clear it, which avoids a
  // cascading render and any frame showing the wrong account's balances.
  const visible = useMemo(
    () => (address !== null && snapshot !== null && snapshot.owner === address ? snapshot : null),
    [address, snapshot],
  );

  const all = useMemo(() => {
    if (visible === null) return NO_TOKENS;
    return visible.native === null ? visible.tokens : [visible.native, ...visible.tokens];
  }, [visible]);

  return {
    native: visible?.native ?? null,
    tokens: visible?.tokens ?? NO_TOKENS,
    all,
    isLoading: address !== null && isLoading,
    error: address === null ? null : error,
    lastUpdated: visible?.lastUpdated ?? null,
    refresh,
  };
}

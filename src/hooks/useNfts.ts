/**
 * NFT loading for the connected wallet.
 *
 * Requires an explorer API: enumerating a wallet's NFTs over plain JSON-RPC
 * would mean scanning `Transfer` logs from genesis, which is not viable from a
 * browser. `isSupported` tells the UI to hide the tab rather than show an empty
 * list that looks like a bug.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChainConfig, NftAsset } from '../types';
import { fetchNfts } from '../services/nft.service';
import { toUserMessage } from '../services/errors';

export interface NftsState {
  readonly items: readonly NftAsset[];
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly isSupported: boolean;
  refresh: () => void;
}

const EMPTY: readonly NftAsset[] = [];

export function useNfts(
  chain: ChainConfig,
  address: string | null,
  options: { readonly enabled?: boolean } = {},
): NftsState {
  const enabled = options.enabled !== false;
  const isSupported = chain.explorer.apiBase !== null;
  const active = address !== null && enabled && isSupported;

  const [loaded, setLoaded] = useState<{
    readonly owner: string;
    readonly items: readonly NftAsset[];
  } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const requestIdRef = useRef(0);

  const refresh = useCallback(() => {
    setRefreshToken((token) => token + 1);
  }, []);

  useEffect(() => {
    if (!active || address === null) return;

    const controller = new AbortController();
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    const load = async (): Promise<void> => {
      setIsLoading(true);
      try {
        const assets = await fetchNfts(chain, address, controller.signal);
        if (requestIdRef.current !== requestId) return;
        setLoaded({ owner: address, items: assets });
        setError(null);
      } catch (caught: unknown) {
        if (requestIdRef.current !== requestId || controller.signal.aborted) return;
        setError(toUserMessage(caught));
      } finally {
        if (requestIdRef.current === requestId) setIsLoading(false);
      }
    };

    void load();
    return () => {
      controller.abort();
    };
  }, [chain, address, active, refreshToken]);

  // Derived during render: a result belonging to a previous account is ignored
  // rather than cleared through an extra state update.
  const items = useMemo(
    () => (active && loaded !== null && loaded.owner === address ? loaded.items : EMPTY),
    [active, loaded, address],
  );

  return {
    items,
    isLoading: active && isLoading,
    error: active ? error : null,
    isSupported,
    refresh,
  };
}

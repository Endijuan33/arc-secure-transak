/**
 * Shared RPC pool for read operations.
 *
 * One pool per chain, created lazily and reused across hooks. Without this every
 * hook would build its own `JsonRpcProvider` set, which defeats the batching
 * (ethers only coalesces calls made through the same provider) and multiplies
 * the connection count against endpoints that rate-limit per IP.
 */

import { useEffect, useMemo } from 'react';
import type { ChainConfig } from '../types';
import { createRpcPool, type RpcPool } from '../services/rpc.service';

const pools = new Map<number, RpcPool>();

/**
 * Track which chain IDs have already had their fastest-endpoint election run.
 *
 * Previously every hook that called `useRpcPool` triggered its own election on
 * mount, so a page with `useBalances` + `useGas` + `useNfts` would fire three
 * concurrent `getBlockNumber` probes against every endpoint — wasting quota and
 * producing race conditions on `activeIndex`. One election per chain per session
 * is sufficient.
 */
const elected = new Set<number>();

/** Get or create the shared pool for a chain. */
export function getSharedPool(chain: ChainConfig): RpcPool {
  const existing = pools.get(chain.id);
  if (existing !== undefined) return existing;
  const created = createRpcPool(chain);
  pools.set(chain.id, created);
  return created;
}

/** Destroy every cached pool. Used on teardown and between tests. */
export function destroySharedPools(): void {
  for (const pool of pools.values()) pool.destroy();
  pools.clear();
  elected.clear();
}

/**
 * The shared pool for `chain`, with a one-time latency election.
 *
 * The pool is keyed on `chain.id` (a number) rather than the `chain` object
 * itself: the config object is recreated on every render in some call sites,
 * which would cause `useMemo` to build a new pool on every render and defeat
 * the whole point of sharing.
 *
 * The election runs exactly once per chain per session and promotes the fastest
 * responding endpoint, so the first balance read is not gated on the slowest
 * node in the list.
 */
export function useRpcPool(chain: ChainConfig): RpcPool {
  // Key on chain.id, not the chain object — see note above.
  const pool = useMemo(() => getSharedPool(chain), [chain.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // Only elect once per chain — additional hooks mounting on the same chain
    // must not re-probe endpoints that are already settled.
    if (elected.has(chain.id)) return;
    elected.add(chain.id);

    const controller = new AbortController();
    void pool.electFastestEndpoint(controller.signal).catch(() => {
      // Every probe failing is survivable: `run` rotates on demand anyway.
      // Remove from elected so a future mount can retry the election.
      elected.delete(chain.id);
    });
    return () => {
      controller.abort();
    };
  }, [pool, chain.id]);

  return pool;
}

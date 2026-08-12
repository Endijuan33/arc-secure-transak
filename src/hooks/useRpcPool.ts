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
}

/**
 * The shared pool for `chain`, with an initial latency election.
 *
 * The election runs once per chain per session and promotes the fastest
 * responding endpoint, so the first balance read is not gated on the slowest
 * node in the list.
 */
export function useRpcPool(chain: ChainConfig): RpcPool {
  const pool = useMemo(() => getSharedPool(chain), [chain]);

  useEffect(() => {
    const controller = new AbortController();
    void pool.electFastestEndpoint(controller.signal).catch(() => {
      // Every probe failing is survivable: `run` rotates on demand anyway.
    });
    return () => {
      controller.abort();
    };
  }, [pool]);

  return pool;
}

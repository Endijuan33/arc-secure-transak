/**
 * RPC transport layer: a pooled, self-healing set of JSON-RPC providers.
 *
 * Responsibilities:
 *  - Keep one lazily-created `JsonRpcProvider` per configured endpoint.
 *  - Rotate to the next endpoint when the active one returns a transient error.
 *  - Retry with exponential backoff and jitter, aborting instantly on signal.
 *  - Batch concurrent reads into a single HTTP request.
 *
 * Batching note: ethers v6 coalesces every call issued in the same macrotask
 * into one JSON-RPC array payload, bounded by `batchMaxCount`. `batchAll` exists
 * to make that behaviour explicit at call sites — issuing the reads together
 * rather than sequentially is what turns N round trips into one.
 */

import { JsonRpcProvider, Network } from 'ethers';
import type { ChainConfig, RpcEndpoint } from '../types';
import { RPC_BACKOFF_BASE_MS, RPC_BACKOFF_MAX_MS, RPC_MAX_ATTEMPTS } from '../config/constants';
import { AbortedError, isAbortError, isTransientError, rethrowable, toUserMessage } from './errors';

/** Reject as soon as `signal` aborts, otherwise resolve after `ms`. */
export function abortableDelay(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new AbortedError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      reject(new AbortedError());
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Throw immediately if the kill switch has been pulled. */
export function throwIfAborted(signal?: AbortSignal | null): void {
  if (signal?.aborted === true) throw new AbortedError();
}

/** Full jitter backoff, capped so a long outage does not produce a long stall. */
function backoffDelay(attempt: number): number {
  const ceiling = Math.min(RPC_BACKOFF_BASE_MS * 2 ** (attempt - 1), RPC_BACKOFF_MAX_MS);
  return Math.round(ceiling / 2 + Math.random() * (ceiling / 2));
}

export interface RetryContext {
  /** 1-based attempt number that just failed. */
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly endpoint: RpcEndpoint;
  readonly message: string;
}

export interface RpcPoolOptions {
  /** Reported when the pool rotates endpoints or schedules a retry. */
  readonly onRetry?: (context: RetryContext) => void;
}

export interface RpcPool {
  readonly chain: ChainConfig;
  /** The provider bound to the currently preferred endpoint. */
  provider(): JsonRpcProvider;
  activeEndpoint(): RpcEndpoint;
  /**
   * Run `operation` against the active provider, rotating endpoints and
   * retrying on transient failures. Terminal failures propagate immediately.
   */
  run<T>(
    label: string,
    operation: (provider: JsonRpcProvider) => Promise<T>,
    options?: { readonly signal?: AbortSignal | null; readonly maxAttempts?: number },
  ): Promise<T>;
  /** Issue reads concurrently so ethers coalesces them into one HTTP batch. */
  batchAll<T extends readonly unknown[]>(
    label: string,
    build: (provider: JsonRpcProvider) => readonly [...{ [K in keyof T]: Promise<T[K]> }],
    options?: { readonly signal?: AbortSignal | null },
  ): Promise<T>;
  /** Probe every endpoint and promote the fastest responder. */
  electFastestEndpoint(signal?: AbortSignal | null): Promise<RpcEndpoint>;
  /** Tear down every provider's polling loop and socket. */
  destroy(): void;
}

function createProvider(chain: ChainConfig, endpoint: RpcEndpoint): JsonRpcProvider {
  // staticNetwork avoids an eth_chainId round trip before every call, and
  // batchMaxCount bounds how many reads are packed into one HTTP request.
  return new JsonRpcProvider(endpoint.url, Network.from(chain.id), {
    staticNetwork: Network.from(chain.id),
    batchMaxCount: 20,
    batchStallTime: 10,
    polling: false,
  });
}

export function createRpcPool(chain: ChainConfig, options: RpcPoolOptions = {}): RpcPool {
  const endpoints = chain.rpcEndpoints;
  if (endpoints.length === 0) {
    throw new Error(`Chain ${chain.name} has no RPC endpoints configured.`);
  }

  // Closure state: providers are cached per endpoint so rotation is cheap and a
  // returning endpoint reuses its warm connection.
  const providers = new Map<string, JsonRpcProvider>();
  let activeIndex = 0;

  const endpointAt = (index: number): RpcEndpoint => {
    const endpoint = endpoints[index % endpoints.length];
    if (endpoint === undefined) {
      throw new Error('RPC endpoint index out of range.');
    }
    return endpoint;
  };

  const providerFor = (endpoint: RpcEndpoint): JsonRpcProvider => {
    const existing = providers.get(endpoint.url);
    if (existing !== undefined) return existing;
    const created = createProvider(chain, endpoint);
    providers.set(endpoint.url, created);
    return created;
  };

  const rotate = (): void => {
    activeIndex = (activeIndex + 1) % endpoints.length;
  };

  const run = async <T>(
    label: string,
    operation: (provider: JsonRpcProvider) => Promise<T>,
    runOptions: { readonly signal?: AbortSignal | null; readonly maxAttempts?: number } = {},
  ): Promise<T> => {
    const maxAttempts = runOptions.maxAttempts ?? RPC_MAX_ATTEMPTS;
    const signal = runOptions.signal ?? null;
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      throwIfAborted(signal);
      const endpoint = endpointAt(activeIndex);
      try {
        return await operation(providerFor(endpoint));
      } catch (error: unknown) {
        if (isAbortError(error)) throw new AbortedError();
        lastError = error;

        const retryable = isTransientError(error);
        if (!retryable || attempt === maxAttempts) throw error;

        options.onRetry?.({
          attempt,
          maxAttempts,
          endpoint,
          message: `${label}: ${toUserMessage(error)}`,
        });

        // Rotate first: the next attempt should not hit the endpoint that just
        // failed, since the most common transient cause is per-endpoint
        // rate limiting rather than a global outage.
        if (endpoints.length > 1) rotate();
        await abortableDelay(backoffDelay(attempt), signal);
      }
    }

    // `lastError` is `unknown`, so it is rethrown through a helper that
    // preserves the original value as `cause` while satisfying the "throw an
    // Error" contract.
    throw rethrowable(lastError, `${label} failed after ${maxAttempts} attempts.`);
  };

  return {
    chain,
    provider: () => providerFor(endpointAt(activeIndex)),
    activeEndpoint: () => endpointAt(activeIndex),
    run,
    batchAll: async <T extends readonly unknown[]>(
      label: string,
      build: (provider: JsonRpcProvider) => readonly [...{ [K in keyof T]: Promise<T[K]> }],
      batchOptions: { readonly signal?: AbortSignal | null } = {},
    ): Promise<T> => {
      const signalOption = batchOptions.signal ?? null;
      return run(
        label,
        async (provider) => {
          const promises: readonly Promise<unknown>[] = build(provider);
          const settled = await Promise.all(promises);
          return settled as unknown as T;
        },
        { signal: signalOption },
      );
    },
    electFastestEndpoint: async (signal?: AbortSignal | null): Promise<RpcEndpoint> => {
      throwIfAborted(signal);

      const probes = endpoints.map(async (endpoint, index) => {
        const started = performance.now();
        await providerFor(endpoint).getBlockNumber();
        return { index, elapsed: performance.now() - started };
      });

      const results = await Promise.allSettled(probes);
      let best: { index: number; elapsed: number } | null = null;
      for (const result of results) {
        if (result.status !== 'fulfilled') continue;
        if (best === null || result.value.elapsed < best.elapsed) best = result.value;
      }

      // Every probe failing is not fatal here: `run` will still rotate through
      // the list on the next real call, and one endpoint may have recovered.
      if (best !== null) activeIndex = best.index;
      return endpointAt(activeIndex);
    },
    destroy: () => {
      for (const provider of providers.values()) provider.destroy();
      providers.clear();
    },
  };
}

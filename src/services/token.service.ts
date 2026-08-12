/**
 * Token discovery and balance reads.
 *
 * Two sources, in priority order:
 *  1. The chain's Blockscout-compatible explorer API — one HTTP request returns
 *     every token the wallet holds, including ones not in the curated list.
 *  2. Batched `balanceOf` calls against the curated `knownTokens` list.
 *
 * Explorer responses are untrusted input: they arrive as `unknown` and every
 * field is narrowed by an explicit guard before it becomes a `TokenBalance`.
 * A malformed entry is dropped rather than allowed to poison the token list.
 */

import { Contract, formatUnits, getAddress, isAddress } from 'ethers';
import type { ChainConfig, TokenBalance, TokenMetadata } from '../types';
import { ERC20_ABI } from '../config/abi';
import { NATIVE_LOGO } from '../config/chains';
import { callRead } from './contract';
import type { RpcPool } from './rpc.service';

/** Format a raw balance for display, trimming trailing zeros but keeping "0". */
export function formatBalance(raw: bigint, decimals: number, maxFractionDigits = 8): string {
  const full = formatUnits(raw, decimals);
  const [whole = '0', fraction] = full.split('.');
  if (fraction === undefined || fraction.length === 0) return whole;
  const trimmed = fraction.slice(0, maxFractionDigits).replace(/0+$/, '');
  return trimmed.length === 0 ? whole : `${whole}.${trimmed}`;
}

/** Build the native `TokenBalance` entry for a chain. */
export function nativeBalanceEntry(chain: ChainConfig, raw: bigint): TokenBalance {
  return {
    kind: 'native',
    address: null,
    symbol: chain.nativeCurrency.symbol,
    name: chain.nativeCurrency.name,
    decimals: chain.nativeCurrency.decimals,
    logo: NATIVE_LOGO,
    raw,
    formatted: formatBalance(raw, chain.nativeCurrency.decimals),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function asDecimals(value: unknown): number | null {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : NaN;
  return Number.isInteger(numeric) && numeric >= 0 && numeric <= 36 ? numeric : null;
}

function asBigInt(value: unknown): bigint | null {
  if (typeof value === 'bigint') return value >= 0n ? value : null;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return BigInt(value.trim());
  return null;
}

/**
 * Narrow one explorer `token-balances` entry into a `TokenBalance`.
 *
 * Returns `null` for anything that is not a well-formed ERC-20 record with a
 * non-zero balance, which also filters out the NFT entries the same endpoint
 * returns.
 */
export function parseExplorerTokenEntry(entry: unknown): TokenBalance | null {
  const record = asRecord(entry);
  if (record === null) return null;

  const tokenRecord = asRecord(record['token']);
  if (tokenRecord === null) return null;

  if (asString(tokenRecord['type']) !== 'ERC-20') return null;

  const rawAddress = asString(tokenRecord['address_hash']) ?? asString(tokenRecord['address']);
  if (rawAddress === null || !isAddress(rawAddress)) return null;

  const symbol = asString(tokenRecord['symbol']);
  const decimals = asDecimals(tokenRecord['decimals']);
  const raw = asBigInt(record['value']);
  if (symbol === null || decimals === null || raw === null) return null;

  let checksummed: string;
  try {
    checksummed = getAddress(rawAddress);
  } catch {
    return null;
  }

  return {
    kind: 'erc20',
    address: checksummed,
    symbol,
    name: asString(tokenRecord['name']) ?? symbol,
    decimals,
    logo: asString(tokenRecord['icon_url']),
    raw,
    formatted: formatBalance(raw, decimals),
  };
}

/**
 * Read ERC-20 balances from the explorer API.
 *
 * Returns `null` — not an empty array — when the API is unreachable or returns
 * an unexpected shape, so the caller can distinguish "no tokens" from
 * "source unavailable" and fall back to RPC.
 */
export async function fetchBalancesFromExplorer(
  chain: ChainConfig,
  wallet: string,
  signal?: AbortSignal | null,
): Promise<TokenBalance[] | null> {
  const apiBase = chain.explorer.apiBase;
  if (apiBase === null) return null;

  const url = `${apiBase.replace(/\/$/, '')}/addresses/${wallet}/token-balances`;
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: signal ?? null,
    });
    if (!response.ok) return null;

    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) return null;

    const tokens: TokenBalance[] = [];
    for (const entry of payload) {
      const parsed = parseExplorerTokenEntry(entry);
      // Zero balances are dropped here: an explorer often keeps historical
      // holdings, and an empty row is noise in the selector.
      if (parsed !== null && parsed.raw > 0n) tokens.push(parsed);
    }
    return tokens;
  } catch {
    return null;
  }
}

/**
 * Read balances for a fixed token list over RPC.
 *
 * Every `balanceOf` is issued in the same tick so ethers coalesces them into one
 * batched JSON-RPC request instead of N sequential round trips.
 */
export async function fetchBalancesFromRpc(
  pool: RpcPool,
  wallet: string,
  tokens: readonly TokenMetadata[],
  signal?: AbortSignal | null,
): Promise<TokenBalance[]> {
  if (tokens.length === 0) return [];

  const settled = await pool.run(
    'Fetch token balances',
    async (provider) => {
      const reads = tokens.map(async (token): Promise<TokenBalance | null> => {
        try {
          const contract = new Contract(token.address, ERC20_ABI, provider);
          const raw = await callRead<bigint>(contract, 'balanceOf', [wallet]);
          return {
            kind: 'erc20',
            address: token.address,
            symbol: token.symbol,
            name: token.name,
            decimals: token.decimals,
            logo: token.logo,
            raw,
            formatted: formatBalance(raw, token.decimals),
          };
        } catch {
          // One bad contract must not blank out the whole token list.
          return null;
        }
      });
      return Promise.all(reads);
    },
    { signal: signal ?? null },
  );

  return settled.filter((entry): entry is TokenBalance => entry !== null);
}

/**
 * Read the wallet's full asset list: native plus every ERC-20 we can find.
 *
 * The native balance and the token reads are issued together so they share one
 * batched request where the endpoint supports it.
 */
export async function fetchAllBalances(
  pool: RpcPool,
  wallet: string,
  extraTokens: readonly TokenMetadata[] = [],
  signal?: AbortSignal | null,
): Promise<{ readonly native: TokenBalance; readonly tokens: readonly TokenBalance[] }> {
  const chain = pool.chain;

  const nativeRaw = await pool.run(
    'Fetch native balance',
    (provider) => provider.getBalance(wallet),
    {
      signal: signal ?? null,
    },
  );
  const native = nativeBalanceEntry(chain, nativeRaw);

  const fromExplorer = await fetchBalancesFromExplorer(chain, wallet, signal);
  if (fromExplorer !== null) {
    // Re-attach curated logos: the explorer's icon_url is often absent.
    const logoByAddress = new Map(
      [...chain.knownTokens, ...extraTokens].map((token) => [
        token.address.toLowerCase(),
        token.logo,
      ]),
    );
    const tokens = fromExplorer
      .filter((token) => token.symbol !== chain.nativeCurrency.symbol)
      .map((token) => {
        const curated =
          token.address === null ? null : logoByAddress.get(token.address.toLowerCase());
        return curated === undefined || curated === null ? token : { ...token, logo: curated };
      });
    return { native, tokens };
  }

  const merged = new Map<string, TokenMetadata>();
  for (const token of [...chain.knownTokens, ...extraTokens]) {
    merged.set(token.address.toLowerCase(), token);
  }
  const tokens = await fetchBalancesFromRpc(pool, wallet, [...merged.values()], signal);
  return { native, tokens };
}

/** Read metadata for an arbitrary ERC-20, for the custom-token importer. */
export async function fetchTokenMetadata(
  pool: RpcPool,
  address: string,
  signal?: AbortSignal | null,
): Promise<TokenMetadata | null> {
  try {
    return await pool.run(
      'Read token metadata',
      async (provider) => {
        const contract = new Contract(address, ERC20_ABI, provider);
        const [symbol, name, decimals] = await Promise.all([
          callRead<string>(contract, 'symbol'),
          callRead<string>(contract, 'name'),
          callRead<bigint>(contract, 'decimals'),
        ]);
        return {
          address: getAddress(address),
          symbol,
          name,
          decimals: Number(decimals),
          logo: null,
        };
      },
      { signal: signal ?? null, maxAttempts: 2 },
    );
  } catch {
    return null;
  }
}

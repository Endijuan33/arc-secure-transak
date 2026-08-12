/**
 * NFT discovery and transfer.
 *
 * Standard detection uses ERC-165 `supportsInterface` rather than trusting the
 * explorer's label, because the transfer signature differs between ERC-721 and
 * ERC-1155 and calling the wrong one either reverts or, worse, matches a
 * different method with the same selector.
 */

import { Contract, getAddress, isAddress } from 'ethers';
import type { ChainConfig, NftAsset } from '../types';
import { ERC1155_ABI, ERC721_ABI, INTERFACE_ID } from '../config/abi';
import { callRead } from './contract';
import type { RpcPool } from './rpc.service';

export type NftStandard = 'erc721' | 'erc1155';

/**
 * Detect which NFT standard a contract implements.
 *
 * Returns `null` when the contract answers neither interface, which means it is
 * not a transferable NFT by this app's definition and must not be dispatched.
 */
export async function detectNftStandard(
  pool: RpcPool,
  contractAddress: string,
  signal?: AbortSignal | null,
): Promise<NftStandard | null> {
  try {
    return await pool.run(
      'Detect NFT standard',
      async (provider) => {
        const contract = new Contract(contractAddress, ERC721_ABI, provider);
        const [is721, is1155] = await Promise.all([
          callRead<boolean>(contract, 'supportsInterface', [INTERFACE_ID.erc721]).catch(
            () => false,
          ),
          callRead<boolean>(contract, 'supportsInterface', [INTERFACE_ID.erc1155]).catch(
            () => false,
          ),
        ]);
        if (is721) return 'erc721' as const;
        if (is1155) return 'erc1155' as const;
        return null;
      },
      { signal: signal ?? null, maxAttempts: 2 },
    );
  } catch {
    return null;
  }
}

/** Confirm `owner` can move `tokenId`, for the standard in use. */
export async function verifyNftOwnership(
  pool: RpcPool,
  standard: NftStandard,
  contractAddress: string,
  tokenId: bigint,
  owner: string,
  signal?: AbortSignal | null,
): Promise<{ readonly owned: boolean; readonly amount: bigint }> {
  return pool.run(
    'Verify NFT ownership',
    async (provider) => {
      if (standard === 'erc721') {
        const contract = new Contract(contractAddress, ERC721_ABI, provider);
        const actual = await callRead<string>(contract, 'ownerOf', [tokenId]);
        const owned = actual.toLowerCase() === owner.toLowerCase();
        return { owned, amount: owned ? 1n : 0n };
      }
      const contract = new Contract(contractAddress, ERC1155_ABI, provider);
      const balance = await callRead<bigint>(contract, 'balanceOf', [owner, tokenId]);
      return { owned: balance > 0n, amount: balance };
    },
    { signal: signal ?? null, maxAttempts: 2 },
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Rewrite an `ipfs://` URI to a public gateway.
 *
 * Returns `null` for any scheme other than https/ipfs/data so a hostile
 * metadata document cannot inject a `javascript:` or `file:` URL into an
 * `<img src>`.
 */
export function normalizeMediaUri(uri: string | null): string | null {
  if (uri === null) return null;
  const trimmed = uri.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.startsWith('ipfs://')) {
    return `https://ipfs.io/ipfs/${trimmed.slice('ipfs://'.length).replace(/^ipfs\//, '')}`;
  }
  if (trimmed.startsWith('https://') || trimmed.startsWith('data:image/')) return trimmed;
  return null;
}

/** Narrow one explorer NFT entry, dropping anything malformed. */
export function parseExplorerNftEntry(entry: unknown): NftAsset | null {
  const record = asRecord(entry);
  if (record === null) return null;

  const tokenRecord = asRecord(record['token']);
  if (tokenRecord === null) return null;

  const type = asString(tokenRecord['type']);
  const standard: NftStandard | null =
    type === 'ERC-721' ? 'erc721' : type === 'ERC-1155' ? 'erc1155' : null;
  if (standard === null) return null;

  const rawAddress = asString(tokenRecord['address_hash']) ?? asString(tokenRecord['address']);
  const tokenId = asString(record['id']) ?? asString(record['token_id']);
  if (rawAddress === null || tokenId === null || !isAddress(rawAddress)) return null;
  if (!/^\d+$/.test(tokenId)) return null;

  const metadata = asRecord(record['metadata']);
  const image =
    metadata === null
      ? null
      : normalizeMediaUri(asString(metadata['image']) ?? asString(metadata['image_url']));

  const rawAmount = asString(record['value']);
  const amount = rawAmount !== null && /^\d+$/.test(rawAmount) ? BigInt(rawAmount) : 1n;

  let checksummed: string;
  try {
    checksummed = getAddress(rawAddress);
  } catch {
    return null;
  }

  return {
    kind: standard,
    contract: checksummed,
    tokenId,
    name: (metadata === null ? null : asString(metadata['name'])) ?? `#${tokenId}`,
    collection: asString(tokenRecord['name']) ?? asString(tokenRecord['symbol']) ?? 'Unknown',
    image,
    amount: standard === 'erc721' ? 1n : amount,
  };
}

/**
 * List the wallet's NFTs via the explorer API.
 *
 * Returns an empty array when no API is configured: enumerating NFTs over plain
 * RPC would require scanning Transfer logs across all of history, which is not
 * viable from a browser.
 */
export async function fetchNfts(
  chain: ChainConfig,
  wallet: string,
  signal?: AbortSignal | null,
): Promise<readonly NftAsset[]> {
  const apiBase = chain.explorer.apiBase;
  if (apiBase === null) return [];

  const url = `${apiBase.replace(/\/$/, '')}/addresses/${wallet}/nft?type=ERC-721,ERC-1155`;
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: signal ?? null,
    });
    if (!response.ok) return [];

    const payload: unknown = await response.json();
    const container = asRecord(payload);
    const items: unknown = container === null ? payload : container['items'];
    if (!Array.isArray(items)) return [];

    const assets: NftAsset[] = [];
    for (const entry of items) {
      const parsed = parseExplorerNftEntry(entry);
      if (parsed !== null) assets.push(parsed);
    }
    return assets;
  } catch {
    return [];
  }
}

/** Read on-chain metadata for one NFT, used when the explorer has no record. */
export async function fetchNftDetails(
  pool: RpcPool,
  standard: NftStandard,
  contractAddress: string,
  tokenId: bigint,
  signal?: AbortSignal | null,
): Promise<NftAsset | null> {
  try {
    return await pool.run(
      'Read NFT metadata',
      async (provider) => {
        if (standard === 'erc721') {
          const contract = new Contract(contractAddress, ERC721_ABI, provider);
          const [collection, uri] = await Promise.all([
            callRead<string>(contract, 'name').catch(() => 'Unknown'),
            callRead<string>(contract, 'tokenURI', [tokenId]).catch(() => ''),
          ]);
          return {
            kind: 'erc721' as const,
            contract: getAddress(contractAddress),
            tokenId: tokenId.toString(),
            name: `#${tokenId.toString()}`,
            collection,
            image: normalizeMediaUri(uri),
            amount: 1n,
          };
        }
        const contract = new Contract(contractAddress, ERC1155_ABI, provider);
        const uri = await callRead<string>(contract, 'uri', [tokenId]).catch(() => '');
        return {
          kind: 'erc1155' as const,
          contract: getAddress(contractAddress),
          tokenId: tokenId.toString(),
          name: `#${tokenId.toString()}`,
          collection: 'Unknown',
          image: normalizeMediaUri(uri),
          amount: 1n,
        };
      },
      { signal: signal ?? null, maxAttempts: 2 },
    );
  } catch {
    return null;
  }
}

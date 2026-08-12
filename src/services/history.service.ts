/**
 * Transaction history in IndexedDB with cursor pagination.
 *
 * localStorage was replaced because it is synchronous (blocking the main thread
 * on every write), capped at a few megabytes shared with everything else on the
 * origin, and offers no indexing — paginating meant parsing the entire history
 * into memory on each render.
 *
 * IndexedDB gives an auto-incrementing primary key that is monotonic per insert.
 * Because IDs only grow, "the page after ID N" is expressible as a bounded range
 * query, so paging is O(page size) rather than O(history size). Cursors are
 * therefore stable under concurrent inserts: a new transaction never shifts the
 * contents of a page the user has already seen.
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  HistoryPage,
  NewTransactionRecord,
  TransactionRecord,
  TransactionStatus,
} from '../types';
import { DB_NAME, DB_VERSION, HISTORY_PAGE_SIZE, TX_STORE } from '../config/constants';

interface ArcDbSchema extends DBSchema {
  [TX_STORE]: {
    key: number;
    value: TransactionRecord;
    indexes: {
      'by-chain': number;
      'by-timestamp': number;
      'by-hash': string;
    };
  };
}

let dbPromise: Promise<IDBPDatabase<ArcDbSchema>> | null = null;

function isIndexedDbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

async function database(): Promise<IDBPDatabase<ArcDbSchema>> {
  if (!isIndexedDbAvailable()) {
    throw new Error('IndexedDB is unavailable in this browser context.');
  }
  dbPromise ??= openDB<ArcDbSchema>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(TX_STORE)) {
        const store = db.createObjectStore(TX_STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('by-chain', 'chainId');
        store.createIndex('by-timestamp', 'timestamp');
        store.createIndex('by-hash', 'hash', { unique: false });
      }
    },
  });
  return dbPromise;
}

/** Reset the cached connection. Used between tests. */
export function resetHistoryConnection(): void {
  dbPromise = null;
}

/**
 * Append a record and return it with its assigned `id`.
 *
 * `id` is omitted from the stored object so IndexedDB assigns it; writing an
 * explicit `undefined` would violate the `keyPath` under `autoIncrement`.
 */
export async function appendTransaction(record: NewTransactionRecord): Promise<TransactionRecord> {
  const db = await database();
  const id = await db.add(TX_STORE, record as TransactionRecord);
  return { ...record, id: Number(id) };
}

/** Patch the status of an existing record. Returns the updated row, or `null`. */
export async function updateTransactionStatus(
  id: number,
  status: TransactionStatus,
  patch: {
    readonly blockNumber?: number | null;
    readonly gasUsed?: string | null;
    readonly errorMessage?: string | null;
  } = {},
): Promise<TransactionRecord | null> {
  const db = await database();
  const tx = db.transaction(TX_STORE, 'readwrite');
  const existing = await tx.store.get(id);
  if (existing === undefined) {
    await tx.done;
    return null;
  }
  const updated: TransactionRecord = {
    ...existing,
    status,
    blockNumber: patch.blockNumber ?? existing.blockNumber,
    gasUsed: patch.gasUsed ?? existing.gasUsed,
    errorMessage: patch.errorMessage ?? existing.errorMessage,
  };
  await tx.store.put(updated);
  await tx.done;
  return updated;
}

/**
 * Read one page of history for a chain, newest first.
 *
 * `cursor` is the `id` of the last row of the previous page. Walking the primary
 * key backwards from `cursor - 1` gives the next page without an offset scan.
 * A chain filter is applied while iterating rather than via the `by-chain`
 * index, because that index is not ordered by `id` and would break the cursor
 * contract.
 */
export async function readHistoryPage(
  chainId: number,
  cursor: number | null = null,
  pageSize: number = HISTORY_PAGE_SIZE,
): Promise<HistoryPage> {
  const db = await database();
  const total = await db.countFromIndex(TX_STORE, 'by-chain', chainId);

  const range =
    cursor === null
      ? null
      : cursor <= 1
        ? undefined // nothing below id 1; signals an immediate stop
        : IDBKeyRange.upperBound(cursor - 1);

  if (range === undefined) {
    return { items: [], nextCursor: null, total };
  }

  const items: TransactionRecord[] = [];
  let idbCursor = await db
    .transaction(TX_STORE, 'readonly')
    .store.openCursor(range ?? null, 'prev');

  while (idbCursor !== null && items.length < pageSize) {
    const value = idbCursor.value;
    if (value.chainId === chainId) items.push(value);
    idbCursor = await idbCursor.continue();
  }

  const last = items.at(-1);
  // A full page means there may be more; a short page means we hit the start.
  const nextCursor = items.length === pageSize && last !== undefined ? last.id : null;
  return { items, nextCursor, total };
}

/** Look up records by transaction hash. */
export async function findByHash(hash: string): Promise<readonly TransactionRecord[]> {
  const db = await database();
  return db.getAllFromIndex(TX_STORE, 'by-hash', hash);
}

/** Count records for a chain. */
export async function countTransactions(chainId: number): Promise<number> {
  const db = await database();
  return db.countFromIndex(TX_STORE, 'by-chain', chainId);
}

/** Delete every record for a chain, leaving other chains intact. */
export async function clearHistory(chainId: number): Promise<void> {
  const db = await database();
  const tx = db.transaction(TX_STORE, 'readwrite');
  const index = tx.store.index('by-chain');
  let cursor = await index.openCursor(IDBKeyRange.only(chainId));
  while (cursor !== null) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}

/** Delete one record. */
export async function deleteTransaction(id: number): Promise<void> {
  const db = await database();
  await db.delete(TX_STORE, id);
}

/**
 * One-time migration of the v1 localStorage history.
 *
 * The old records had no chain id, sender, or burner address, so those are
 * backfilled from the supplied defaults. The legacy key is removed only after a
 * successful import, making the migration safe to interrupt.
 */
export async function migrateLegacyHistory(
  legacyKey: string,
  defaults: { readonly chainId: number; readonly sender: string },
): Promise<number> {
  if (typeof localStorage === 'undefined') return 0;

  const raw = localStorage.getItem(legacyKey);
  if (raw === null) return 0;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    localStorage.removeItem(legacyKey);
    return 0;
  }
  if (!Array.isArray(parsed)) {
    localStorage.removeItem(legacyKey);
    return 0;
  }

  let imported = 0;
  // Reversed: the legacy array was newest-first, and appending in that order
  // would assign descending timestamps to ascending ids.
  const legacyEntries: readonly unknown[] = [...(parsed as readonly unknown[])].reverse();
  for (const entry of legacyEntries) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const hash = typeof record['hash'] === 'string' ? record['hash'] : null;
    if (hash === null) continue;

    const existing = await findByHash(hash);
    if (existing.length > 0) continue;

    await appendTransaction({
      hash,
      chainId: defaults.chainId,
      kind: record['token'] === 'Native' ? 'native' : 'erc20',
      symbol: typeof record['token'] === 'string' ? record['token'] : 'Unknown',
      amount: typeof record['amount'] === 'string' ? record['amount'] : '0',
      recipient: typeof record['recipient'] === 'string' ? record['recipient'] : '',
      sender: defaults.sender,
      burner: '',
      tokenId: null,
      status: record['status'] === 'success' ? 'confirmed' : 'failed',
      timestamp: typeof record['timestamp'] === 'number' ? record['timestamp'] : Date.now(),
      blockNumber: null,
      gasUsed: null,
      errorMessage: null,
    });
    imported += 1;
  }

  localStorage.removeItem(legacyKey);
  return imported;
}

import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  appendTransaction,
  clearHistory,
  countTransactions,
  deleteTransaction,
  findByHash,
  migrateLegacyHistory,
  readHistoryPage,
  resetHistoryConnection,
  updateTransactionStatus,
} from '../../src/services/history.service';
import type { NewTransactionRecord } from '../../src/types';

const CHAIN_A = 5042002;
const CHAIN_B = 11155111;

function record(overrides: Partial<NewTransactionRecord> = {}): NewTransactionRecord {
  return {
    hash: `0x${'11'.repeat(32)}`,
    chainId: CHAIN_A,
    kind: 'native',
    symbol: 'USDC',
    amount: '1.5',
    recipient: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
    sender: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    burner: '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
    tokenId: null,
    status: 'confirmed',
    timestamp: Date.now(),
    blockNumber: 100,
    gasUsed: '21000',
    errorMessage: null,
    ...overrides,
  };
}

/** Insert `count` records with distinct hashes, oldest first. */
async function seed(count: number, chainId = CHAIN_A): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await appendTransaction(
      record({
        chainId,
        hash: `0x${i.toString(16).padStart(64, '0')}`,
        amount: String(i),
        timestamp: 1_700_000_000_000 + i * 1_000,
      }),
    );
  }
}

beforeEach(() => {
  // A fresh IndexedDB per test: the cached connection would otherwise carry
  // rows across tests and make cursor assertions order-dependent.
  globalThis.indexedDB = new IDBFactory();
  resetHistoryConnection();
});

describe('appendTransaction', () => {
  it('assigns an incrementing id', async () => {
    const first = await appendTransaction(record({ hash: `0x${'a1'.repeat(32)}` }));
    const second = await appendTransaction(record({ hash: `0x${'a2'.repeat(32)}` }));

    expect(first.id).toBeGreaterThan(0);
    expect(second.id).toBeGreaterThan(first.id);
  });

  it('round-trips every field', async () => {
    const input = record({ kind: 'erc721', tokenId: '42', symbol: 'PUNK' });
    const stored = await appendTransaction(input);
    const page = await readHistoryPage(CHAIN_A);

    expect(page.items[0]).toEqual({ ...input, id: stored.id });
  });
});

describe('readHistoryPage', () => {
  it('returns an empty page when nothing is stored', async () => {
    const page = await readHistoryPage(CHAIN_A);
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
    expect(page.total).toBe(0);
  });

  it('returns the newest records first', async () => {
    await seed(3);
    const page = await readHistoryPage(CHAIN_A);
    expect(page.items.map((entry) => entry.amount)).toEqual(['2', '1', '0']);
  });

  it('respects the page size and reports a cursor', async () => {
    await seed(5);
    const page = await readHistoryPage(CHAIN_A, null, 2);

    expect(page.items).toHaveLength(2);
    expect(page.total).toBe(5);
    expect(page.nextCursor).toBe(page.items[1]?.id);
  });

  it('walks every record exactly once across pages', async () => {
    await seed(7);

    const seen: string[] = [];
    let cursor: number | null = null;
    let guard = 0;

    do {
      const page = await readHistoryPage(CHAIN_A, cursor, 3);
      seen.push(...page.items.map((entry) => entry.amount));
      cursor = page.nextCursor;
      guard += 1;
    } while (cursor !== null && guard < 10);

    expect(seen).toEqual(['6', '5', '4', '3', '2', '1', '0']);
    expect(new Set(seen).size).toBe(7);
  });

  it('reports no cursor on a partial final page', async () => {
    await seed(4);
    const first = await readHistoryPage(CHAIN_A, null, 3);
    const second = await readHistoryPage(CHAIN_A, first.nextCursor, 3);

    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
  });

  it('keeps earlier pages stable when a new record is inserted', async () => {
    await seed(4);
    const first = await readHistoryPage(CHAIN_A, null, 2);

    // A concurrent insert gets a higher id, so it lands above the cursor and
    // cannot shift the contents of the page already delivered.
    await appendTransaction(record({ hash: `0x${'ff'.repeat(32)}`, amount: '99' }));

    const second = await readHistoryPage(CHAIN_A, first.nextCursor, 2);
    expect(second.items.map((entry) => entry.amount)).toEqual(['1', '0']);
    expect(second.items.some((entry) => entry.amount === '99')).toBe(false);
  });

  it('isolates chains from one another', async () => {
    await seed(2, CHAIN_A);
    await seed(3, CHAIN_B);

    const pageA = await readHistoryPage(CHAIN_A);
    const pageB = await readHistoryPage(CHAIN_B);

    expect(pageA.total).toBe(2);
    expect(pageB.total).toBe(3);
    expect(pageA.items.every((entry) => entry.chainId === CHAIN_A)).toBe(true);
    expect(pageB.items.every((entry) => entry.chainId === CHAIN_B)).toBe(true);
  });

  it('skips other chains while paging', async () => {
    // Interleaved ids: the cursor walks the primary key, so the chain filter has
    // to be applied during iteration rather than by seeking.
    await appendTransaction(
      record({ chainId: CHAIN_A, hash: `0x${'01'.repeat(32)}`, amount: 'a1' }),
    );
    await appendTransaction(
      record({ chainId: CHAIN_B, hash: `0x${'02'.repeat(32)}`, amount: 'b1' }),
    );
    await appendTransaction(
      record({ chainId: CHAIN_A, hash: `0x${'03'.repeat(32)}`, amount: 'a2' }),
    );
    await appendTransaction(
      record({ chainId: CHAIN_B, hash: `0x${'04'.repeat(32)}`, amount: 'b2' }),
    );

    const page = await readHistoryPage(CHAIN_A);
    expect(page.items.map((entry) => entry.amount)).toEqual(['a2', 'a1']);
  });

  it('returns an empty page for a cursor at the start', async () => {
    await seed(2);
    const page = await readHistoryPage(CHAIN_A, 1);
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });
});

describe('updateTransactionStatus', () => {
  it('patches the status and receipt fields', async () => {
    const created = await appendTransaction(record({ status: 'pending', blockNumber: null }));

    const updated = await updateTransactionStatus(created.id, 'confirmed', {
      blockNumber: 512,
      gasUsed: '45000',
    });

    expect(updated?.status).toBe('confirmed');
    expect(updated?.blockNumber).toBe(512);
    expect(updated?.gasUsed).toBe('45000');
  });

  it('records a failure message', async () => {
    const created = await appendTransaction(record({ status: 'pending' }));
    const updated = await updateTransactionStatus(created.id, 'failed', {
      errorMessage: 'reverted',
    });
    expect(updated?.status).toBe('failed');
    expect(updated?.errorMessage).toBe('reverted');
  });

  it('leaves unspecified fields untouched', async () => {
    const created = await appendTransaction(record({ blockNumber: 7, gasUsed: '21000' }));
    const updated = await updateTransactionStatus(created.id, 'aborted');
    expect(updated?.blockNumber).toBe(7);
    expect(updated?.gasUsed).toBe('21000');
  });

  it('returns null for an unknown id', async () => {
    expect(await updateTransactionStatus(9999, 'confirmed')).toBeNull();
  });
});

describe('findByHash, countTransactions, deleteTransaction, clearHistory', () => {
  it('finds records by hash', async () => {
    const hash = `0x${'cd'.repeat(32)}`;
    await appendTransaction(record({ hash }));
    const found = await findByHash(hash);
    expect(found).toHaveLength(1);
    expect(found[0]?.hash).toBe(hash);
  });

  it('returns nothing for an unknown hash', async () => {
    expect(await findByHash(`0x${'ee'.repeat(32)}`)).toHaveLength(0);
  });

  it('counts per chain', async () => {
    await seed(3, CHAIN_A);
    await seed(1, CHAIN_B);
    expect(await countTransactions(CHAIN_A)).toBe(3);
    expect(await countTransactions(CHAIN_B)).toBe(1);
  });

  it('deletes one record', async () => {
    const created = await appendTransaction(record());
    await deleteTransaction(created.id);
    expect(await countTransactions(CHAIN_A)).toBe(0);
  });

  it('clears only the requested chain', async () => {
    await seed(2, CHAIN_A);
    await seed(2, CHAIN_B);

    await clearHistory(CHAIN_A);

    expect(await countTransactions(CHAIN_A)).toBe(0);
    expect(await countTransactions(CHAIN_B)).toBe(2);
  });
});

describe('migrateLegacyHistory', () => {
  const LEGACY_KEY = 'arc_tx_history';
  const defaults = { chainId: CHAIN_A, sender: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' };

  it('imports legacy records and removes the old key', async () => {
    localStorage.setItem(
      LEGACY_KEY,
      JSON.stringify([
        {
          hash: `0x${'aa'.repeat(32)}`,
          token: 'EURC',
          amount: '5',
          recipient: '0xabc',
          timestamp: 2000,
          status: 'success',
        },
        {
          hash: `0x${'bb'.repeat(32)}`,
          token: 'Native',
          amount: '1',
          recipient: '0xdef',
          timestamp: 1000,
          status: 'success',
        },
      ]),
    );

    const imported = await migrateLegacyHistory(LEGACY_KEY, defaults);

    expect(imported).toBe(2);
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    expect(await countTransactions(CHAIN_A)).toBe(2);
  });

  it('preserves chronological order in the assigned ids', async () => {
    // The legacy array was newest-first; ids must still ascend with time.
    localStorage.setItem(
      LEGACY_KEY,
      JSON.stringify([
        {
          hash: `0x${'aa'.repeat(32)}`,
          token: 'Native',
          amount: 'newer',
          recipient: '0xa',
          timestamp: 2000,
          status: 'success',
        },
        {
          hash: `0x${'bb'.repeat(32)}`,
          token: 'Native',
          amount: 'older',
          recipient: '0xb',
          timestamp: 1000,
          status: 'success',
        },
      ]),
    );

    await migrateLegacyHistory(LEGACY_KEY, defaults);

    const page = await readHistoryPage(CHAIN_A);
    expect(page.items.map((entry) => entry.amount)).toEqual(['newer', 'older']);
  });

  it('maps the legacy token label onto the asset kind', async () => {
    localStorage.setItem(
      LEGACY_KEY,
      JSON.stringify([
        {
          hash: `0x${'aa'.repeat(32)}`,
          token: 'Native',
          amount: '1',
          recipient: '0xa',
          timestamp: 1,
          status: 'success',
        },
        {
          hash: `0x${'bb'.repeat(32)}`,
          token: 'EURC',
          amount: '1',
          recipient: '0xb',
          timestamp: 2,
          status: 'success',
        },
      ]),
    );

    await migrateLegacyHistory(LEGACY_KEY, defaults);

    const page = await readHistoryPage(CHAIN_A);
    const kinds = page.items.map((entry) => `${entry.symbol}:${entry.kind}`).sort();
    expect(kinds).toEqual(['EURC:erc20', 'Native:native']);
  });

  it('is idempotent, skipping hashes already present', async () => {
    const payload = JSON.stringify([
      {
        hash: `0x${'aa'.repeat(32)}`,
        token: 'Native',
        amount: '1',
        recipient: '0xa',
        timestamp: 1,
        status: 'success',
      },
    ]);

    localStorage.setItem(LEGACY_KEY, payload);
    expect(await migrateLegacyHistory(LEGACY_KEY, defaults)).toBe(1);

    localStorage.setItem(LEGACY_KEY, payload);
    expect(await migrateLegacyHistory(LEGACY_KEY, defaults)).toBe(0);
    expect(await countTransactions(CHAIN_A)).toBe(1);
  });

  it('returns zero when there is nothing to migrate', async () => {
    expect(await migrateLegacyHistory(LEGACY_KEY, defaults)).toBe(0);
  });

  it('discards malformed JSON and clears the key', async () => {
    localStorage.setItem(LEGACY_KEY, 'not json at all');
    expect(await migrateLegacyHistory(LEGACY_KEY, defaults)).toBe(0);
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it('discards a non-array payload', async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ nope: true }));
    expect(await migrateLegacyHistory(LEGACY_KEY, defaults)).toBe(0);
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it('skips entries without a hash', async () => {
    localStorage.setItem(
      LEGACY_KEY,
      JSON.stringify([{ token: 'Native', amount: '1' }, null, 'garbage']),
    );
    expect(await migrateLegacyHistory(LEGACY_KEY, defaults)).toBe(0);
  });

  it('maps a non-success legacy status to failed', async () => {
    localStorage.setItem(
      LEGACY_KEY,
      JSON.stringify([
        {
          hash: `0x${'aa'.repeat(32)}`,
          token: 'Native',
          amount: '1',
          recipient: '0xa',
          timestamp: 1,
          status: 'error',
        },
      ]),
    );
    await migrateLegacyHistory(LEGACY_KEY, defaults);
    const page = await readHistoryPage(CHAIN_A);
    expect(page.items[0]?.status).toBe('failed');
  });
});

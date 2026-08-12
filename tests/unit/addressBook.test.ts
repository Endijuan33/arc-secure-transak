import { beforeEach, describe, expect, it } from 'vitest';
import {
  addAddressBookEntry,
  exportAddressBook,
  importAddressBook,
  loadAddressBook,
  removeAddressBookEntry,
  saveAddressBook,
  searchAddressBook,
} from '../../src/services/addressBook.service';
import { STORAGE_KEYS } from '../../src/config/constants';
import type { AddressBookEntry } from '../../src/types';

const ALICE = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const BOB = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';
const CAROL = '0x90F79bf6EB2c4f870365E785982E1f101E93b906';

function entry(address: string, tag: string): AddressBookEntry {
  return { id: `${tag}-id`, address, tag, chainId: null, createdAt: 1_700_000_000_000 };
}

beforeEach(() => {
  localStorage.clear();
});

describe('addAddressBookEntry', () => {
  it('appends a validated entry', () => {
    const result = addAddressBookEntry([], ALICE, 'Alice');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]?.address).toBe(ALICE);
      expect(result.entries[0]?.tag).toBe('Alice');
    }
  });

  it('stores the chain id when supplied', () => {
    const result = addAddressBookEntry([], ALICE, 'Alice', 5042002);
    if (result.ok) expect(result.entries[0]?.chainId).toBe(5042002);
  });

  it('rejects an invalid address', () => {
    const result = addAddressBookEntry([], 'nonsense', 'Alice');
    expect(result.ok).toBe(false);
  });

  it('rejects an invalid tag', () => {
    const result = addAddressBookEntry([], ALICE, '   ');
    expect(result.ok).toBe(false);
  });

  it('rejects a duplicate address regardless of case', () => {
    const first = addAddressBookEntry([], ALICE, 'Alice');
    if (!first.ok) throw new Error('setup failed');

    const second = addAddressBookEntry(first.entries, ALICE.toLowerCase(), 'Alice again');
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toMatch(/already saved/i);
  });

  it('does not mutate the input array', () => {
    const original: readonly AddressBookEntry[] = [entry(ALICE, 'Alice')];
    addAddressBookEntry(original, BOB, 'Bob');
    expect(original).toHaveLength(1);
  });

  it('assigns unique ids', () => {
    const first = addAddressBookEntry([], ALICE, 'Alice');
    if (!first.ok) throw new Error('setup failed');
    const second = addAddressBookEntry(first.entries, BOB, 'Bob');
    if (!second.ok) throw new Error('setup failed');

    const ids = second.entries.map((item) => item.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('enforces the entry cap', () => {
    const full = Array.from({ length: 200 }, (_, index) => ({
      id: String(index),
      address: `0x${index.toString(16).padStart(40, '0')}`,
      tag: `Tag ${index}`,
      chainId: null,
      createdAt: index,
    }));
    const result = addAddressBookEntry(full, ALICE, 'Overflow');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/limited to 200/i);
  });
});

describe('removeAddressBookEntry', () => {
  it('removes by id', () => {
    const entries = [entry(ALICE, 'Alice'), entry(BOB, 'Bob')];
    const result = removeAddressBookEntry(entries, 'Alice-id');
    expect(result).toHaveLength(1);
    expect(result[0]?.tag).toBe('Bob');
  });

  it('is a no-op for an unknown id', () => {
    const entries = [entry(ALICE, 'Alice')];
    expect(removeAddressBookEntry(entries, 'missing')).toHaveLength(1);
  });
});

describe('searchAddressBook', () => {
  const entries = [entry(ALICE, 'Alice Cold'), entry(BOB, 'Bob Hot'), entry(CAROL, 'Carol')];

  it('returns everything for an empty query', () => {
    expect(searchAddressBook(entries, '   ')).toHaveLength(3);
  });

  it('matches a tag case-insensitively', () => {
    expect(searchAddressBook(entries, 'alice')).toHaveLength(1);
  });

  it('matches a partial address', () => {
    const result = searchAddressBook(entries, BOB.slice(2, 10).toLowerCase());
    expect(result).toHaveLength(1);
    expect(result[0]?.tag).toBe('Bob Hot');
  });

  it('returns nothing when no entry matches', () => {
    expect(searchAddressBook(entries, 'zzzz')).toHaveLength(0);
  });
});

describe('persistence', () => {
  it('round-trips through localStorage', () => {
    const entries = [entry(ALICE, 'Alice')];
    expect(saveAddressBook(entries)).toBe(true);
    expect(loadAddressBook()).toEqual(entries);
  });

  it('returns an empty book when nothing is stored', () => {
    expect(loadAddressBook()).toEqual([]);
  });

  it('drops malformed entries instead of failing', () => {
    localStorage.setItem(
      STORAGE_KEYS.addressBook,
      JSON.stringify([
        entry(ALICE, 'Alice'),
        { address: 'not-an-address', tag: 'Bad' },
        { address: BOB },
        null,
        'garbage',
      ]),
    );
    const loaded = loadAddressBook();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.address).toBe(ALICE);
  });

  it('returns an empty book for malformed JSON', () => {
    localStorage.setItem(STORAGE_KEYS.addressBook, '{{{');
    expect(loadAddressBook()).toEqual([]);
  });

  it('deduplicates stored entries by address', () => {
    localStorage.setItem(
      STORAGE_KEYS.addressBook,
      JSON.stringify([entry(ALICE, 'First'), entry(ALICE.toLowerCase(), 'Second')]),
    );
    expect(loadAddressBook()).toHaveLength(1);
  });

  it('reads the legacy v1 key and clears it on the next save', () => {
    localStorage.setItem('arc_address_book', JSON.stringify([entry(ALICE, 'Legacy')]));

    const loaded = loadAddressBook();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.tag).toBe('Legacy');

    saveAddressBook(loaded);
    expect(localStorage.getItem('arc_address_book')).toBeNull();
    expect(loadAddressBook()).toHaveLength(1);
  });

  it('backfills a missing id from the address', () => {
    localStorage.setItem(
      STORAGE_KEYS.addressBook,
      JSON.stringify([{ address: ALICE, tag: 'No id' }]),
    );
    const loaded = loadAddressBook();
    expect(loaded[0]?.id).toBe(ALICE.toLowerCase());
  });

  it('accepts a numeric legacy id', () => {
    localStorage.setItem(
      STORAGE_KEYS.addressBook,
      JSON.stringify([{ id: 1699999999999, address: ALICE, tag: 'Numeric' }]),
    );
    expect(loadAddressBook()[0]?.id).toBe('1699999999999');
  });
});

describe('export and import', () => {
  it('exports a versioned document', () => {
    const json = exportAddressBook([entry(ALICE, 'Alice')]);
    const parsed: unknown = JSON.parse(json);
    expect(parsed).toMatchObject({ version: 2 });
  });

  it('round-trips an export back into an empty book', () => {
    const original = [entry(ALICE, 'Alice'), entry(BOB, 'Bob')];
    const result = importAddressBook([], exportAddressBook(original));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.added).toBe(2);
      expect(result.entries.map((item) => item.address).sort()).toEqual([ALICE, BOB].sort());
    }
  });

  it('accepts a bare array', () => {
    const result = importAddressBook([], JSON.stringify([entry(ALICE, 'Alice')]));
    expect(result.ok).toBe(true);
  });

  it('keeps the existing entry when addresses collide', () => {
    const current = [entry(ALICE, 'My label')];
    const incoming = exportAddressBook([entry(ALICE, 'Stale label'), entry(BOB, 'Bob')]);

    const result = importAddressBook(current, incoming);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.added).toBe(1);
      const alice = result.entries.find((item) => item.address === ALICE);
      expect(alice?.tag).toBe('My label');
    }
  });

  it('rejects invalid JSON', () => {
    const result = importAddressBook([], 'not json');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not valid json/i);
  });

  it('rejects a document with no entries array', () => {
    const result = importAddressBook([], JSON.stringify({ version: 2 }));
    expect(result.ok).toBe(false);
  });

  it('reports when there is nothing new to import', () => {
    const current = [entry(ALICE, 'Alice')];
    const result = importAddressBook(current, exportAddressBook(current));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/no new addresses/i);
  });

  it('skips malformed entries in the imported file', () => {
    const payload = JSON.stringify({
      version: 2,
      entries: [entry(ALICE, 'Alice'), { address: 'bad', tag: 'x' }, null],
    });
    const result = importAddressBook([], payload);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.added).toBe(1);
  });
});

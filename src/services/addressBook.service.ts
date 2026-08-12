/**
 * Address book persistence.
 *
 * Stays in localStorage: the data is tiny, synchronous access is convenient for
 * a first render, and unlike history it does not grow without bound. Every read
 * treats the stored JSON as untrusted and validates each entry, so a corrupted
 * or hand-edited value degrades to "fewer bookmarks" rather than a crash.
 */

import type { AddressBookEntry } from '../types';
import { STORAGE_KEYS } from '../config/constants';
import { validateContractAddress, validateTag } from '../security/validation';

const LEGACY_KEY = 'arc_address_book';
const MAX_ENTRIES = 200;

function storageAvailable(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage !== null;
  } catch {
    return false;
  }
}

function parseEntry(value: unknown): AddressBookEntry | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;

  const addressCheck = validateContractAddress(record['address']);
  if (!addressCheck.ok) return null;

  const tagCheck = validateTag(record['tag']);
  if (!tagCheck.ok) return null;

  const rawId = record['id'];
  const id =
    typeof rawId === 'string' && rawId.length > 0
      ? rawId
      : typeof rawId === 'number'
        ? String(rawId)
        : addressCheck.value.toLowerCase();

  const rawChain = record['chainId'];
  const chainId = typeof rawChain === 'number' && Number.isSafeInteger(rawChain) ? rawChain : null;

  const rawCreated = record['createdAt'];
  const createdAt = typeof rawCreated === 'number' && rawCreated > 0 ? rawCreated : Date.now();

  return { id, address: addressCheck.value, tag: tagCheck.value, chainId, createdAt };
}

/** Read the book, dropping any malformed entries. */
export function loadAddressBook(): readonly AddressBookEntry[] {
  if (!storageAvailable()) return [];
  const raw = localStorage.getItem(STORAGE_KEYS.addressBook) ?? localStorage.getItem(LEGACY_KEY);
  if (raw === null) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const seen = new Set<string>();
  const entries: AddressBookEntry[] = [];
  for (const item of parsed) {
    const entry = parseEntry(item);
    if (entry === null) continue;
    const key = entry.address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(entry);
  }
  return entries.slice(0, MAX_ENTRIES);
}

/** Overwrite the stored book. Returns `false` when the write was rejected. */
export function saveAddressBook(entries: readonly AddressBookEntry[]): boolean {
  if (!storageAvailable()) return false;
  try {
    localStorage.setItem(STORAGE_KEYS.addressBook, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
    localStorage.removeItem(LEGACY_KEY);
    return true;
  } catch {
    // Quota exceeded or storage disabled; the in-memory list stays authoritative.
    return false;
  }
}

export type AddResult =
  | { readonly ok: true; readonly entries: readonly AddressBookEntry[] }
  | { readonly ok: false; readonly error: string };

/** Validate and append an entry, rejecting duplicates by address. */
export function addAddressBookEntry(
  entries: readonly AddressBookEntry[],
  address: unknown,
  tag: unknown,
  chainId: number | null = null,
): AddResult {
  const addressCheck = validateContractAddress(address);
  if (!addressCheck.ok) return { ok: false, error: addressCheck.error };

  const tagCheck = validateTag(tag);
  if (!tagCheck.ok) return { ok: false, error: tagCheck.error };

  if (entries.length >= MAX_ENTRIES) {
    return { ok: false, error: `The address book is limited to ${MAX_ENTRIES} entries.` };
  }
  if (entries.some((entry) => entry.address.toLowerCase() === addressCheck.value.toLowerCase())) {
    return { ok: false, error: 'That address is already saved.' };
  }

  const entry: AddressBookEntry = {
    id:
      typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    address: addressCheck.value,
    tag: tagCheck.value,
    chainId,
    createdAt: Date.now(),
  };
  return { ok: true, entries: [...entries, entry] };
}

/** Remove an entry by id. */
export function removeAddressBookEntry(
  entries: readonly AddressBookEntry[],
  id: string,
): readonly AddressBookEntry[] {
  return entries.filter((entry) => entry.id !== id);
}

/** Case-insensitive search over tag and address. */
export function searchAddressBook(
  entries: readonly AddressBookEntry[],
  query: string,
): readonly AddressBookEntry[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return entries;
  return entries.filter(
    (entry) =>
      entry.tag.toLowerCase().includes(needle) || entry.address.toLowerCase().includes(needle),
  );
}

/** Serialise the book for download. */
export function exportAddressBook(entries: readonly AddressBookEntry[]): string {
  return JSON.stringify({ version: 2, exportedAt: Date.now(), entries }, null, 2);
}

export type ImportResult =
  | { readonly ok: true; readonly entries: readonly AddressBookEntry[]; readonly added: number }
  | { readonly ok: false; readonly error: string };

/**
 * Merge an exported file into the current book.
 *
 * Existing entries win on address collision, so importing a stale backup cannot
 * silently relabel a bookmark the user has since renamed.
 */
export function importAddressBook(
  current: readonly AddressBookEntry[],
  json: string,
): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: 'That file is not valid JSON.' };
  }

  const container =
    typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
  const rawEntries: unknown = Array.isArray(parsed) ? parsed : container?.['entries'];
  if (!Array.isArray(rawEntries)) {
    return { ok: false, error: 'No address book entries found in that file.' };
  }

  const merged = [...current];
  const known = new Set(current.map((entry) => entry.address.toLowerCase()));
  let added = 0;

  for (const item of rawEntries) {
    if (merged.length >= MAX_ENTRIES) break;
    const entry = parseEntry(item);
    if (entry === null) continue;
    const key = entry.address.toLowerCase();
    if (known.has(key)) continue;
    known.add(key);
    merged.push(entry);
    added += 1;
  }

  if (added === 0) {
    return { ok: false, error: 'No new addresses to import.' };
  }
  return { ok: true, entries: merged, added };
}

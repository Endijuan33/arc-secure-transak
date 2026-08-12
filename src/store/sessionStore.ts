/**
 * Session store: the connected wallet, selected chain, theme, and address book.
 *
 * Zustand was chosen over Context API because the transfer pipeline needs to
 * write state from outside the React tree (from a service callback, mid-await),
 * and needs to do so many times per second without re-rendering every consumer.
 * A Context value would force a provider re-render on each pipeline event and
 * cascade through the whole component tree; Zustand's selector subscriptions let
 * each component re-render only when the specific slice it reads changes.
 */

import { create } from 'zustand';
import type { AddressBookEntry, ChainConfig, GasSpeed, ThemeMode } from '../types';
import { DEFAULT_CHAIN, findChain } from '../config/chains';
import { STORAGE_KEYS } from '../config/constants';
import {
  addAddressBookEntry,
  loadAddressBook,
  removeAddressBookEntry,
  saveAddressBook,
} from '../services/addressBook.service';

function readStoredTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.theme);
    if (stored === 'light' || stored === 'dark') return stored;
    // No stored choice: follow the OS preference on first visit.
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

function readStoredChain(): ChainConfig {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.chain);
    if (stored === null) return DEFAULT_CHAIN;
    const parsed = Number.parseInt(stored, 10);
    return findChain(parsed) ?? DEFAULT_CHAIN;
  } catch {
    return DEFAULT_CHAIN;
  }
}

function persist(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private browsing or a full quota; the in-memory value still applies.
  }
}

interface SessionState {
  readonly chain: ChainConfig;
  readonly theme: ThemeMode;
  readonly gasSpeed: GasSpeed;
  readonly addressBook: readonly AddressBookEntry[];
  setChain: (chainId: number) => void;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
  setGasSpeed: (speed: GasSpeed) => void;
  addBookmark: (address: unknown, tag: unknown) => { ok: boolean; error?: string };
  removeBookmark: (id: string) => void;
  replaceAddressBook: (entries: readonly AddressBookEntry[]) => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  chain: readStoredChain(),
  theme: readStoredTheme(),
  gasSpeed: 'standard',
  addressBook: loadAddressBook(),

  setChain: (chainId) => {
    const chain = findChain(chainId);
    if (chain === undefined) return;
    persist(STORAGE_KEYS.chain, String(chain.id));
    set({ chain });
  },

  setTheme: (theme) => {
    persist(STORAGE_KEYS.theme, theme);
    set({ theme });
  },

  toggleTheme: () => {
    const next: ThemeMode = get().theme === 'dark' ? 'light' : 'dark';
    persist(STORAGE_KEYS.theme, next);
    set({ theme: next });
  },

  setGasSpeed: (gasSpeed) => {
    set({ gasSpeed });
  },

  addBookmark: (address, tag) => {
    const result = addAddressBookEntry(get().addressBook, address, tag, get().chain.id);
    if (!result.ok) return { ok: false, error: result.error };
    saveAddressBook(result.entries);
    set({ addressBook: result.entries });
    return { ok: true };
  },

  removeBookmark: (id) => {
    const entries = removeAddressBookEntry(get().addressBook, id);
    saveAddressBook(entries);
    set({ addressBook: entries });
  },

  replaceAddressBook: (entries) => {
    saveAddressBook(entries);
    set({ addressBook: entries });
  },
}));

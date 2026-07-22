// src/utils/helpers.js
import { ethers } from 'ethers';
import { CACHE_TTL, BALANCE_CACHE_KEY, ADDRESS_BOOK_KEY, TX_HISTORY_KEY } from '../config/constants';

export const safeFormat = (value) => {
  const num = parseFloat(value);
  return isNaN(num) ? '0.00000000' : num.toFixed(8);
};

export const formatTime = (ts) => {
  const d = new Date(ts);
  const dateStr = d.toLocaleDateString('id-ID');
  const timeStr = d.toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  return `${dateStr}, ${timeStr}`;
};

export const loadCachedBalances = () => {
  try {
    const raw = localStorage.getItem(BALANCE_CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (Date.now() - data.timestamp > CACHE_TTL) return null;
    return data.balances;
  } catch {
    return null;
  }
};

export const saveCachedBalances = (balances) => {
  try {
    localStorage.setItem(BALANCE_CACHE_KEY, JSON.stringify({
      timestamp: Date.now(),
      balances
    }));
  } catch {
    // ignore
  }
};

export const loadAddressBook = () => {
  try {
    const raw = localStorage.getItem(ADDRESS_BOOK_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

export const saveAddressBook = (book) => {
  try {
    localStorage.setItem(ADDRESS_BOOK_KEY, JSON.stringify(book));
  } catch {
    // ignore
  }
};

export const loadTransactions = () => {
  try {
    const raw = localStorage.getItem(TX_HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

export const saveTransactions = (txs) => {
  try {
    localStorage.setItem(TX_HISTORY_KEY, JSON.stringify(txs));
  } catch {
    // ignore
  }
};

export const isAddress = (addr) => ethers.isAddress(addr);

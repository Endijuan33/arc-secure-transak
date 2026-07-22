// src/config/constants.js
export const ICONS = {
  wallet: '👛',
  address: '📍',
  amount: '💰',
  check: '✅',
  error: '❌',
  loading: '⏳',
  info: 'ℹ️',
  copy: '📋',
  external: '🔗',
  history: '📜',
  addressBook: '📒',
  add: '➕',
  delete: '🗑️',
};

export const TX_HISTORY_KEY = 'arc_tx_history';
export const BALANCE_CACHE_KEY = 'arc_balances_cache';
export const ADDRESS_BOOK_KEY = 'arc_address_book';
export const CACHE_TTL = 30000; // 30 seconds
export const ITEMS_PER_PAGE = 10;
export const SAFETY_BUFFER = 0.001; // USDC for gas
export const MIN_BALANCE_FOR_GAS = 0.002;

/** Application-wide constants that are not chain-specific. */

/** UI glyphs, kept in one place so labels stay consistent. */
export const ICONS = {
  wallet: '👛',
  address: '📍',
  amount: '💰',
  check: '✅',
  error: '❌',
  loading: '⏳',
  info: 'ℹ️',
  warning: '⚠️',
  copy: '📋',
  external: '🔗',
  history: '📜',
  addressBook: '📒',
  add: '➕',
  delete: '🗑️',
  shield: '🛡️',
  abort: '🛑',
  nft: '🖼️',
  gas: '⛽',
  theme: '🌗',
} as const;

/** Persisted-storage keys. Namespaced so a schema change can bump the suffix. */
export const STORAGE_KEYS = {
  addressBook: 'arc.addressBook.v2',
  theme: 'arc.theme.v1',
  chain: 'arc.chain.v1',
  customTokens: 'arc.customTokens.v1',
} as const;

/** IndexedDB database and object-store names. */
export const DB_NAME = 'arc-secure-transak';
export const DB_VERSION = 1;
export const TX_STORE = 'transactions';

/** Transaction-history page size for cursor pagination. */
export const HISTORY_PAGE_SIZE = 10;

/** Balance polling interval. */
export const BALANCE_REFRESH_MS = 30_000;

/** In-memory balance cache lifetime. */
export const BALANCE_CACHE_TTL_MS = 15_000;

/** Debounce delay for search and address inputs. */
export const INPUT_DEBOUNCE_MS = 300;

/** Gas-speed multipliers, applied as a percentage of the estimated fee. */
export const GAS_SPEED_MULTIPLIER = {
  standard: 120n,
  fast: 150n,
  instant: 200n,
} as const;

/** Extra headroom added to a simulated gas limit, as a percentage. */
export const GAS_LIMIT_HEADROOM_PERCENT = 130n;

/**
 * Headroom applied to the base fee when predicting what a transaction will
 * actually be charged, as a percentage.
 *
 * EIP-1559 caps a base-fee increase at 12.5% per block, so 112.5% covers the
 * worst case one block ahead. Expressed against a 1000-denominator because
 * 112.5 is not an integer.
 */
export const BASE_FEE_HEADROOM_PERCENT = 1125n;
export const BASE_FEE_HEADROOM_DIVISOR = 1000n;

/**
 * Safety cushion added to the burner's funding, as a percentage of measured gas
 * cost.
 *
 * Proportional rather than flat: a constant sized for a congested chain would
 * reject users on a cheap one who could comfortably afford the transfer. 25%
 * absorbs two consecutive maximum base-fee increases with room to spare.
 */
export const FUNDING_BUFFER_PERCENT = 25n;

/** Intrinsic gas for a plain native transfer. */
export const NATIVE_TRANSFER_GAS = 21_000n;

/** Conservative gas limits used when simulation is rejected by the node. */
export const FALLBACK_GAS_LIMIT = {
  erc20: 120_000n,
  erc721: 180_000n,
  erc1155: 220_000n,
} as const;

/** Receipt polling budget: attempts x interval is the total wait. */
export const RECEIPT_POLL_ATTEMPTS = 40;
export const RECEIPT_POLL_INTERVAL_MS = 5_000;

/** RPC retry policy. */
export const RPC_MAX_ATTEMPTS = 5;
export const RPC_BACKOFF_BASE_MS = 1_500;
export const RPC_BACKOFF_MAX_MS = 12_000;

/** Attempts for the final burner-originated dispatch before giving up. */
export const FINAL_DISPATCH_ATTEMPTS = 3;

/** Notification display durations by level, in milliseconds. */
export const NOTIFICATION_DURATION_MS = {
  success: 4_000,
  info: 4_000,
  warning: 6_000,
  error: 8_000,
} as const;

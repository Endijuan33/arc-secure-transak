/**
 * Error classification and user-facing messages.
 *
 * Raw provider errors are `unknown` and frequently deeply nested (ethers wraps
 * the JSON-RPC body, which wraps the node's own error object). Everything here
 * narrows `unknown` without assertions so a malformed error object cannot crash
 * the handler that is trying to report a failure.
 */

/** Thrown when the user activates the kill switch. Recognised across the pipeline. */
export class AbortedError extends Error {
  override readonly name = 'AbortedError';

  constructor(message = 'Operation aborted by the user.') {
    super(message);
  }
}

/** A validation rejection surfaced to the user verbatim. */
export class ValidationError extends Error {
  override readonly name = 'ValidationError';

  constructor(message: string) {
    super(message);
  }
}

/** A rate-limit rejection. */
export class RateLimitError extends Error {
  override readonly name = 'RateLimitError';

  constructor(
    message: string,
    readonly retryAfterMs: number,
  ) {
    super(message);
  }
}

/** An error that should never be retried (rejection, insufficient funds, wrong chain). */
export class TerminalError extends Error {
  override readonly name = 'TerminalError';

  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
  }
}

/**
 * Wrap an `unknown` caught value into something throwable.
 *
 * Returns the value unchanged when it is already an `Error`, so the original
 * stack and type checks survive. Otherwise it is preserved as `cause` under a
 * new `Error`, which keeps `throw` statements type-safe without discarding
 * information from providers that reject with plain objects or strings.
 */
export function rethrowable(error: unknown, fallbackMessage: string): Error {
  if (error instanceof Error) return error;
  if (error === null || error === undefined) return new Error(fallbackMessage);
  const text = extractErrorText(error);
  return new Error(text.length > 0 ? text : fallbackMessage, { cause: error });
}

export function isAbortError(error: unknown): boolean {
  if (error instanceof AbortedError) return true;
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  const text = extractErrorText(error).toLowerCase();
  return text.includes('manual_abort') || text.includes('aborted by the user');
}

/**
 * Collect every string found in an error object graph.
 *
 * Providers hide the useful signal at varying depths — `error.message`,
 * `error.info.error.message`, `error.error.data.message`, `error.shortMessage` —
 * so the whole graph is flattened rather than guessing one path. Recursion is
 * depth- and breadth-bounded so a cyclic or enormous object cannot hang the UI.
 */
export function extractErrorText(error: unknown, depth = 0, seen = new WeakSet<object>()): string {
  if (depth > 5) return '';
  if (error === null || error === undefined) return '';
  if (typeof error === 'string') return error;
  if (typeof error === 'number' || typeof error === 'boolean' || typeof error === 'bigint') {
    return String(error);
  }
  if (typeof error !== 'object') return '';
  if (seen.has(error)) return '';
  seen.add(error);

  const parts: string[] = [];

  if (error instanceof Error) {
    parts.push(error.message);
  }

  const record = error as Record<string, unknown>;
  for (const key of [
    'message',
    'shortMessage',
    'reason',
    'code',
    'data',
    'error',
    'info',
    'cause',
    'body',
  ]) {
    if (!(key in record)) continue;
    const nested = record[key];
    if (typeof nested === 'string' || typeof nested === 'number') {
      parts.push(String(nested));
    } else if (typeof nested === 'object' && nested !== null) {
      const text = extractErrorText(nested, depth + 1, seen);
      if (text.length > 0) parts.push(text);
    }
  }

  return parts.join(' | ');
}

/** Substrings that mean a retry with a different endpoint may succeed. */
const TRANSIENT_MARKERS: readonly string[] = [
  '-32011',
  '-32005',
  '-32603',
  'request limit',
  'rate limit',
  'too many requests',
  'timeout',
  'etimedout',
  'econnreset',
  'econnrefused',
  'enotfound',
  'socket hang up',
  'network error',
  'failed to fetch',
  'load failed',
  'coalesce error',
  'server_error',
  'bad_data',
  'service unavailable',
  'bad gateway',
  'gateway timeout',
  'connection closed',
  'could not coalesce',
  'missing response',
];

/** Substrings that mean retrying is pointless. */
const TERMINAL_MARKERS: readonly string[] = [
  'user rejected',
  'user denied',
  'action_rejected',
  'insufficient funds',
  'insufficient balance',
  'session expired',
  'not connected',
  'no provider',
  'unauthorized',
  'invalid chain',
  'wrong network',
  'nonce too low',
  'already known',
  'execution reverted',
  'transfer amount exceeds balance',
];

export function isTransientError(error: unknown): boolean {
  if (isAbortError(error)) return false;
  const text = extractErrorText(error).toLowerCase();
  if (TERMINAL_MARKERS.some((marker) => text.includes(marker))) return false;
  return TRANSIENT_MARKERS.some((marker) => text.includes(marker));
}

export function isTerminalError(error: unknown): boolean {
  if (error instanceof TerminalError) return true;
  if (error instanceof ValidationError) return true;
  const text = extractErrorText(error).toLowerCase();
  return TERMINAL_MARKERS.some((marker) => text.includes(marker));
}

/** True when the failure is an under-priced or gas-shaped error worth re-quoting. */
export function isGasPricingError(error: unknown): boolean {
  const text = extractErrorText(error).toLowerCase();
  return (
    text.includes('underpriced') ||
    text.includes('fee too low') ||
    text.includes('max fee per gas less than block base fee') ||
    text.includes('intrinsic gas too low') ||
    text.includes('gas required exceeds') ||
    text.includes('replacement transaction')
  );
}

/**
 * True when a contract call failed in a way that suggests the address is not the
 * expected token standard, rather than the call merely reverting.
 */
export function isContractShapeError(error: unknown): boolean {
  const text = extractErrorText(error).toLowerCase();
  return (
    text.includes('missing revert data') ||
    text.includes('call_exception') ||
    text.includes('could not decode result data') ||
    text.includes('bad_data')
  );
}

interface FriendlyRule {
  readonly match: readonly string[];
  readonly message: string;
}

const FRIENDLY_RULES: readonly FriendlyRule[] = [
  {
    match: ['user rejected', 'user denied', 'action_rejected'],
    message: 'You rejected the request in your wallet.',
  },
  {
    match: ['insufficient funds', 'insufficient balance'],
    message: 'Your wallet does not hold enough to cover the transfer plus network fees.',
  },
  {
    match: ['transfer amount exceeds balance'],
    message: 'The token contract rejected the transfer: the balance is lower than the amount.',
  },
  {
    match: ['-32011', 'request limit', 'rate limit', 'too many requests'],
    message: 'Every RPC endpoint is rate limiting us right now. Please retry shortly.',
  },
  {
    match: ['not connected', 'no provider', 'session expired', 'unauthorized'],
    message: 'Your wallet session ended. Reconnect and try again.',
  },
  {
    match: ['wrong network', 'invalid chain'],
    message: 'Your wallet is on a different network. Switch to the selected chain.',
  },
  {
    match: ['nonce too low', 'already known', 'replacement transaction'],
    message: 'A conflicting transaction is already in flight. Wait for it to settle, then retry.',
  },
  {
    match: ['underpriced', 'fee too low', 'max fee per gas less than block base fee'],
    message: 'The network raised its fees mid-flight. Retry to re-quote gas.',
  },
  {
    match: ['execution reverted'],
    message: 'The contract rejected this transfer. Check the token, recipient, and amount.',
  },
  {
    match: ['missing revert data', 'could not decode result data'],
    message: 'That contract did not respond as a standard token on this network.',
  },
  {
    match: ['timeout', 'etimedout'],
    message: 'The network timed out. It may be congested; please try again.',
  },
  {
    match: ['failed to fetch', 'load failed', 'network error', 'econnrefused', 'enotfound'],
    message: 'Could not reach any RPC endpoint. Check your internet connection.',
  },
  {
    match: ['crypto.subtle', 'secure context'],
    message: 'Secure key storage needs HTTPS or localhost. Open the app over a secure origin.',
  },
];

const MAX_FALLBACK_LENGTH = 180;

/** Convert any thrown value into a single actionable sentence. */
export function toUserMessage(error: unknown): string {
  if (isAbortError(error)) {
    return 'Transaction aborted. Recovery of any moved assets was attempted.';
  }
  if (error instanceof ValidationError || error instanceof RateLimitError) {
    return error.message;
  }

  const text = extractErrorText(error);
  const lower = text.toLowerCase();
  for (const rule of FRIENDLY_RULES) {
    if (rule.match.some((marker) => lower.includes(marker))) return rule.message;
  }

  if (error instanceof Error && error.message.length > 0) {
    return error.message.length > MAX_FALLBACK_LENGTH
      ? `${error.message.slice(0, MAX_FALLBACK_LENGTH)}…`
      : error.message;
  }
  if (text.length > 0) {
    return text.length > MAX_FALLBACK_LENGTH ? `${text.slice(0, MAX_FALLBACK_LENGTH)}…` : text;
  }
  return 'An unexpected error occurred.';
}

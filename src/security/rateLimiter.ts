/**
 * Rate limiting for transaction submission.
 *
 * Two independent guards, both required to pass:
 *
 *  - A sliding window cap on how many transactions may start in a period.
 *  - A minimum cooldown between consecutive starts.
 *
 * Both are enforced in-memory only. This is a UX and accident guard — a
 * defence against double-submit, a stuck key, and runaway retry loops. It is
 * not a security boundary against a determined local attacker, who can simply
 * reload the page. Real enforcement is on-chain via nonces.
 */

export interface RateLimitConfig {
  /** Maximum starts permitted inside `windowMs`. */
  readonly maxInWindow: number;
  readonly windowMs: number;
  /** Minimum gap between two consecutive starts. */
  readonly cooldownMs: number;
}

export const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  maxInWindow: 5,
  windowMs: 60_000,
  cooldownMs: 3_000,
};

export type RateLimitDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string; readonly retryAfterMs: number };

/** Injectable clock so tests do not depend on wall time. */
export type Clock = () => number;

export interface RateLimiter {
  /** Test whether an action may start now, without consuming a slot. */
  check(): RateLimitDecision;
  /** Test and, when allowed, consume a slot. */
  tryConsume(): RateLimitDecision;
  /** Drop all recorded history. */
  reset(): void;
  /** Slots still available in the current window. */
  remaining(): number;
}

function formatSeconds(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  return seconds === 1 ? '1 second' : `${seconds} seconds`;
}

export function createRateLimiter(
  config: RateLimitConfig = DEFAULT_RATE_LIMIT,
  clock: Clock = () => Date.now(),
): RateLimiter {
  if (config.maxInWindow < 1) {
    throw new Error('Rate limiter requires maxInWindow >= 1.');
  }
  if (config.windowMs < 0 || config.cooldownMs < 0) {
    throw new Error('Rate limiter windows must be non-negative.');
  }

  // Closure state: not reachable from outside, and not a module-level global,
  // so separate limiters (per chain, per test) never share history.
  let timestamps: number[] = [];

  const prune = (now: number): void => {
    const cutoff = now - config.windowMs;
    timestamps = timestamps.filter((entry) => entry > cutoff);
  };

  const evaluate = (now: number): RateLimitDecision => {
    prune(now);

    const last = timestamps.length > 0 ? Math.max(...timestamps) : null;
    if (last !== null) {
      const sinceLast = now - last;
      if (sinceLast < config.cooldownMs) {
        const retryAfterMs = config.cooldownMs - sinceLast;
        return {
          allowed: false,
          reason: `Please wait ${formatSeconds(retryAfterMs)} before starting another transaction.`,
          retryAfterMs,
        };
      }
    }

    if (timestamps.length >= config.maxInWindow) {
      const oldest = Math.min(...timestamps);
      const retryAfterMs = Math.max(0, oldest + config.windowMs - now);
      return {
        allowed: false,
        reason: `Rate limit reached (${config.maxInWindow} per ${Math.round(
          config.windowMs / 1000,
        )}s). Try again in ${formatSeconds(retryAfterMs)}.`,
        retryAfterMs,
      };
    }

    return { allowed: true };
  };

  return {
    check: () => evaluate(clock()),
    tryConsume: () => {
      const now = clock();
      const decision = evaluate(now);
      if (decision.allowed) timestamps.push(now);
      return decision;
    },
    reset: () => {
      timestamps = [];
    },
    remaining: () => {
      prune(clock());
      return Math.max(0, config.maxInWindow - timestamps.length);
    },
  };
}

/**
 * Process-wide limiter used by the transak store.
 *
 * Exported as a singleton because the constraint it models — "this browser tab
 * may start N transactions per minute" — is genuinely global. Tests construct
 * their own instances via `createRateLimiter` instead of touching this one.
 */
export const transactionRateLimiter: RateLimiter = createRateLimiter();

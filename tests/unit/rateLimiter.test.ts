import { describe, expect, it } from 'vitest';
import { createRateLimiter, type RateLimitConfig } from '../../src/security/rateLimiter';

/** A controllable clock so the tests never depend on wall time. */
function fakeClock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

const CONFIG: RateLimitConfig = { maxInWindow: 3, windowMs: 60_000, cooldownMs: 5_000 };

describe('createRateLimiter', () => {
  it('allows the first attempt', () => {
    const limiter = createRateLimiter(CONFIG, fakeClock().now);
    expect(limiter.tryConsume().allowed).toBe(true);
  });

  it('blocks a second attempt inside the cooldown', () => {
    const clock = fakeClock();
    const limiter = createRateLimiter(CONFIG, clock.now);

    expect(limiter.tryConsume().allowed).toBe(true);
    clock.advance(1_000);

    const decision = limiter.tryConsume();
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.retryAfterMs).toBe(4_000);
      expect(decision.reason).toMatch(/wait 4 seconds/i);
    }
  });

  it('allows the next attempt once the cooldown elapses', () => {
    const clock = fakeClock();
    const limiter = createRateLimiter(CONFIG, clock.now);

    limiter.tryConsume();
    clock.advance(5_000);
    expect(limiter.tryConsume().allowed).toBe(true);
  });

  it('enforces the window cap', () => {
    const clock = fakeClock();
    const limiter = createRateLimiter(CONFIG, clock.now);

    for (let i = 0; i < CONFIG.maxInWindow; i += 1) {
      expect(limiter.tryConsume().allowed).toBe(true);
      clock.advance(CONFIG.cooldownMs);
    }

    const decision = limiter.tryConsume();
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toMatch(/rate limit reached/i);
  });

  it('frees a slot once the oldest entry leaves the window', () => {
    const clock = fakeClock();
    const limiter = createRateLimiter(CONFIG, clock.now);

    for (let i = 0; i < CONFIG.maxInWindow; i += 1) {
      limiter.tryConsume();
      clock.advance(CONFIG.cooldownMs);
    }
    expect(limiter.tryConsume().allowed).toBe(false);

    // Step past the window relative to the first recorded attempt.
    clock.advance(CONFIG.windowMs);
    expect(limiter.tryConsume().allowed).toBe(true);
  });

  it('reports the wait until a slot frees up', () => {
    const clock = fakeClock();
    const limiter = createRateLimiter(CONFIG, clock.now);

    limiter.tryConsume(); // t = 0
    clock.advance(5_000);
    limiter.tryConsume(); // t = 5s
    clock.advance(5_000);
    limiter.tryConsume(); // t = 10s
    clock.advance(5_000); // t = 15s, cooldown satisfied but window full

    const decision = limiter.tryConsume();
    expect(decision.allowed).toBe(false);
    // The oldest entry was at t=0 and expires at t=60s, so 45s remain.
    if (!decision.allowed) expect(decision.retryAfterMs).toBe(45_000);
  });

  it('does not consume a slot when only checking', () => {
    const clock = fakeClock();
    const limiter = createRateLimiter(CONFIG, clock.now);

    expect(limiter.check().allowed).toBe(true);
    expect(limiter.check().allowed).toBe(true);
    expect(limiter.remaining()).toBe(CONFIG.maxInWindow);

    limiter.tryConsume();
    expect(limiter.remaining()).toBe(CONFIG.maxInWindow - 1);
  });

  it('tracks remaining capacity across the window', () => {
    const clock = fakeClock();
    const limiter = createRateLimiter(CONFIG, clock.now);

    expect(limiter.remaining()).toBe(3);
    limiter.tryConsume();
    expect(limiter.remaining()).toBe(2);

    clock.advance(CONFIG.windowMs + 1);
    expect(limiter.remaining()).toBe(3);
  });

  it('clears history on reset', () => {
    const clock = fakeClock();
    const limiter = createRateLimiter(CONFIG, clock.now);

    limiter.tryConsume();
    expect(limiter.tryConsume().allowed).toBe(false);

    limiter.reset();
    expect(limiter.remaining()).toBe(CONFIG.maxInWindow);
    expect(limiter.tryConsume().allowed).toBe(true);
  });

  it('keeps separate instances independent', () => {
    const clock = fakeClock();
    const a = createRateLimiter(CONFIG, clock.now);
    const b = createRateLimiter(CONFIG, clock.now);

    a.tryConsume();
    expect(a.tryConsume().allowed).toBe(false);
    expect(b.tryConsume().allowed).toBe(true);
  });

  it('supports a zero cooldown', () => {
    const clock = fakeClock();
    const limiter = createRateLimiter(
      { maxInWindow: 2, windowMs: 10_000, cooldownMs: 0 },
      clock.now,
    );
    expect(limiter.tryConsume().allowed).toBe(true);
    expect(limiter.tryConsume().allowed).toBe(true);
    expect(limiter.tryConsume().allowed).toBe(false);
  });

  it('rejects an invalid configuration', () => {
    expect(() => createRateLimiter({ maxInWindow: 0, windowMs: 1, cooldownMs: 0 })).toThrow();
    expect(() => createRateLimiter({ maxInWindow: 1, windowMs: -1, cooldownMs: 0 })).toThrow();
    expect(() => createRateLimiter({ maxInWindow: 1, windowMs: 1, cooldownMs: -1 })).toThrow();
  });

  it('uses singular phrasing for a one-second wait', () => {
    const clock = fakeClock();
    const limiter = createRateLimiter(
      { maxInWindow: 5, windowMs: 60_000, cooldownMs: 1_000 },
      clock.now,
    );
    limiter.tryConsume();
    const decision = limiter.tryConsume();
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toMatch(/wait 1 second\b/i);
  });
});

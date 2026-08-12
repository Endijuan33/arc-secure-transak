import { describe, expect, it } from 'vitest';
import {
  AbortedError,
  RateLimitError,
  TerminalError,
  ValidationError,
  extractErrorText,
  isAbortError,
  isContractShapeError,
  isGasPricingError,
  isTerminalError,
  isTransientError,
  rethrowable,
  toUserMessage,
} from '../../src/services/errors';

describe('extractErrorText', () => {
  it('reads a plain Error message', () => {
    expect(extractErrorText(new Error('boom'))).toContain('boom');
  });

  it('reads a bare string', () => {
    expect(extractErrorText('boom')).toBe('boom');
  });

  it('digs into a nested provider error graph', () => {
    // ethers wraps the JSON-RPC body, which wraps the node's own error, so the
    // useful signal is several levels down.
    const nested = {
      code: 'SERVER_ERROR',
      info: { error: { code: -32011, message: 'request limit reached' } },
    };
    const text = extractErrorText(nested);
    expect(text).toContain('-32011');
    expect(text).toContain('request limit reached');
  });

  it('reads a shortMessage field', () => {
    expect(extractErrorText({ shortMessage: 'user rejected action' })).toContain('user rejected');
  });

  it('survives a cyclic object', () => {
    const cyclic: Record<string, unknown> = { message: 'outer' };
    cyclic['self'] = cyclic;
    cyclic['cause'] = cyclic;
    expect(() => extractErrorText(cyclic)).not.toThrow();
    expect(extractErrorText(cyclic)).toContain('outer');
  });

  it('returns an empty string for null and undefined', () => {
    expect(extractErrorText(null)).toBe('');
    expect(extractErrorText(undefined)).toBe('');
  });

  it('stringifies primitives', () => {
    expect(extractErrorText(42)).toBe('42');
    expect(extractErrorText(true)).toBe('true');
    expect(extractErrorText(7n)).toBe('7');
  });

  it('stops at the depth limit', () => {
    let deep: Record<string, unknown> = { message: 'bottom' };
    for (let i = 0; i < 20; i += 1) deep = { cause: deep };
    expect(() => extractErrorText(deep)).not.toThrow();
  });
});

describe('isAbortError', () => {
  it('recognises AbortedError', () => {
    expect(isAbortError(new AbortedError())).toBe(true);
  });

  it('recognises a DOMException AbortError', () => {
    expect(isAbortError(new DOMException('stopped', 'AbortError'))).toBe(true);
  });

  it('recognises the legacy MANUAL_ABORT marker', () => {
    // The v1 pipeline signalled aborts with this string; recognising it keeps a
    // mid-flight upgrade from misreporting an abort as a failure.
    expect(isAbortError(new Error('MANUAL_ABORT'))).toBe(true);
  });

  it('does not treat an ordinary failure as an abort', () => {
    expect(isAbortError(new Error('insufficient funds'))).toBe(false);
  });
});

describe('isTransientError', () => {
  it.each([
    ['rate limit code', { info: { error: { code: -32011 } } }],
    ['request limit', new Error('request limit reached')],
    ['timeout', new Error('ETIMEDOUT')],
    ['connection reset', new Error('ECONNRESET')],
    ['fetch failure', new Error('Failed to fetch')],
    ['coalesce', new Error('could not coalesce error')],
    ['bad gateway', new Error('bad gateway')],
  ])('treats %s as retryable', (_label, error) => {
    expect(isTransientError(error)).toBe(true);
  });

  it.each([
    ['user rejection', new Error('user rejected transaction')],
    ['insufficient funds', new Error('insufficient funds for gas')],
    ['revert', new Error('execution reverted')],
    ['nonce too low', new Error('nonce too low')],
  ])('treats %s as not retryable', (_label, error) => {
    expect(isTransientError(error)).toBe(false);
  });

  it('never retries an abort', () => {
    expect(isTransientError(new AbortedError())).toBe(false);
  });

  it('prefers the terminal marker when both appear', () => {
    // A rejection that also mentions a timeout must not be retried: retrying
    // would re-prompt the wallet the user just dismissed.
    expect(isTransientError(new Error('timeout after user rejected request'))).toBe(false);
  });
});

describe('isTerminalError', () => {
  it('recognises the typed errors', () => {
    expect(isTerminalError(new TerminalError('nope'))).toBe(true);
    expect(isTerminalError(new ValidationError('bad input'))).toBe(true);
  });

  it('recognises terminal markers in the text', () => {
    expect(isTerminalError(new Error('user denied message signature'))).toBe(true);
  });

  it('does not flag a transient failure', () => {
    expect(isTerminalError(new Error('ETIMEDOUT'))).toBe(false);
  });
});

describe('isGasPricingError', () => {
  it.each([
    ['underpriced', new Error('transaction underpriced')],
    ['base fee', new Error('max fee per gas less than block base fee')],
    ['intrinsic gas', new Error('intrinsic gas too low')],
    ['replacement', new Error('replacement transaction underpriced')],
  ])('recognises %s', (_label, error) => {
    expect(isGasPricingError(error)).toBe(true);
  });

  it('ignores unrelated failures', () => {
    expect(isGasPricingError(new Error('user rejected'))).toBe(false);
  });
});

describe('isContractShapeError', () => {
  it('recognises a decode failure', () => {
    expect(isContractShapeError(new Error('could not decode result data'))).toBe(true);
  });

  it('recognises missing revert data', () => {
    expect(isContractShapeError(new Error('missing revert data'))).toBe(true);
  });

  it('ignores an ordinary revert', () => {
    expect(isContractShapeError(new Error('execution reverted: not owner'))).toBe(false);
  });
});

describe('rethrowable', () => {
  it('passes an Error through unchanged', () => {
    const original = new Error('keep me');
    expect(rethrowable(original, 'fallback')).toBe(original);
  });

  it('wraps a non-Error and preserves it as cause', () => {
    const wrapped = rethrowable({ message: 'plain object failure' }, 'fallback');
    expect(wrapped).toBeInstanceOf(Error);
    expect(wrapped.message).toContain('plain object failure');
    expect(wrapped.cause).toEqual({ message: 'plain object failure' });
  });

  it('uses the fallback for null', () => {
    expect(rethrowable(null, 'fallback message').message).toBe('fallback message');
  });

  it('uses the fallback for an empty object', () => {
    expect(rethrowable({}, 'fallback message').message).toBe('fallback message');
  });
});

describe('toUserMessage', () => {
  it('reports an abort plainly', () => {
    expect(toUserMessage(new AbortedError())).toMatch(/aborted/i);
  });

  it('passes a validation message through verbatim', () => {
    expect(toUserMessage(new ValidationError('Amount must be greater than zero.'))).toBe(
      'Amount must be greater than zero.',
    );
  });

  it('passes a rate-limit message through verbatim', () => {
    expect(toUserMessage(new RateLimitError('Please wait 3 seconds.', 3000))).toBe(
      'Please wait 3 seconds.',
    );
  });

  it.each([
    ['user rejected', 'rejected the request'],
    ['insufficient funds for intrinsic transaction cost', 'does not hold enough'],
    ['request limit reached', 'rate limiting'],
    ['session expired', 'session ended'],
    ['nonce too low', 'conflicting transaction'],
    ['transaction underpriced', 'raised its fees'],
    ['execution reverted', 'contract rejected'],
    ['missing revert data', 'standard token'],
    ['ETIMEDOUT', 'timed out'],
    ['Failed to fetch', 'internet connection'],
  ])('maps %s to an actionable sentence', (raw, expected) => {
    expect(toUserMessage(new Error(raw)).toLowerCase()).toContain(expected.toLowerCase());
  });

  it('truncates a very long unmatched message', () => {
    const message = toUserMessage(new Error('x'.repeat(500)));
    expect(message.length).toBeLessThanOrEqual(181);
    expect(message.endsWith('…')).toBe(true);
  });

  it('handles a thrown non-Error', () => {
    expect(toUserMessage({ reason: 'weird failure' })).toContain('weird failure');
  });

  it('falls back for a completely empty value', () => {
    expect(toUserMessage(undefined)).toBe('An unexpected error occurred.');
    expect(toUserMessage({})).toBe('An unexpected error occurred.');
  });

  it('explains the secure-context requirement', () => {
    expect(toUserMessage(new Error('crypto.subtle is unavailable'))).toMatch(/https|localhost/i);
  });
});

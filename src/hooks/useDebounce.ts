/**
 * Debounce helpers for search and address inputs.
 *
 * `useDebouncedValue` is preferred over debouncing the change handler: keeping
 * the input controlled and un-debounced means typing never feels laggy, while
 * the expensive consumer (a filter pass, an on-chain lookup) only sees the
 * settled value.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { INPUT_DEBOUNCE_MS } from '../config/constants';

/** The value, updated only after it has been stable for `delayMs`. */
export function useDebouncedValue<T>(value: T, delayMs: number = INPUT_DEBOUNCE_MS): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

/**
 * A debounced wrapper around `callback`.
 *
 * The callback is held in a ref so the returned function is referentially stable
 * even when the caller passes a fresh closure each render — otherwise every
 * render would cancel the pending call and the debounce would never fire.
 */
export function useDebouncedCallback<Args extends readonly unknown[]>(
  callback: (...args: Args) => void,
  delayMs: number = INPUT_DEBOUNCE_MS,
): (...args: Args) => void {
  const callbackRef = useRef(callback);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  return useCallback(
    (...args: Args) => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        callbackRef.current(...args);
      }, delayMs);
    },
    [delayMs],
  );
}

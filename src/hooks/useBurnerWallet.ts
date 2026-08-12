/**
 * Burner session inspection and the gated key-reveal escape hatch.
 *
 * The reveal path exists because an on-chain recovery failure would otherwise
 * mean permanent loss: the burner holds real assets and its key exists nowhere
 * but this tab's memory. The previous version printed that key to the console
 * and into the status log on every recovery failure, which leaked it to anything
 * reading `console` and to any screen recording of the page.
 *
 * This version narrows the exposure to a single explicit user action:
 *  - the key is only ever produced by `reveal()`, never on an automatic path;
 *  - the caller must pass an explicit confirmation flag;
 *  - the value is never logged, never persisted, and never sent anywhere;
 *  - it is dropped from React state on hide, on unmount, and after a timeout.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { revealPrivateKeyForRecovery } from '../security/keyVault';
import { toUserMessage } from '../services/errors';
import { useTransferStore } from '../store/transferStore';

/** The revealed key is cleared automatically after this long. */
const AUTO_HIDE_MS = 60_000;

export interface BurnerRecoveryState {
  readonly burnerAddress: string | null;
  readonly reason: string | null;
  readonly hasStrandedFunds: boolean;
  readonly revealedKey: string | null;
  readonly isRevealing: boolean;
  readonly error: string | null;
  readonly secondsUntilHide: number | null;
  /** Requires `userConfirmed` to be literally `true`. */
  reveal: (userConfirmed: boolean) => Promise<void>;
  hide: () => void;
  /** Destroy the vault session and dismiss the recovery panel. */
  dismiss: () => void;
}

export function useBurnerWallet(): BurnerRecoveryState {
  const stranded = useTransferStore((state) => state.stranded);
  const dismissStranded = useTransferStore((state) => state.dismissStranded);

  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [isRevealing, setIsRevealing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hideAt, setHideAt] = useState<number | null>(null);
  const [secondsUntilHide, setSecondsUntilHide] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearKey = useCallback(() => {
    setRevealedKey(null);
    setHideAt(null);
    setSecondsUntilHide(null);
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Drop the key if the component unmounts while it is on screen.
  useEffect(() => clearKey, [clearKey]);

  useEffect(() => {
    if (hideAt === null) return;
    const tick = (): void => {
      const remaining = Math.max(0, Math.ceil((hideAt - Date.now()) / 1000));
      setSecondsUntilHide(remaining);
      if (remaining === 0) clearKey();
    };
    tick();
    const interval = setInterval(tick, 1_000);
    return () => clearInterval(interval);
  }, [hideAt, clearKey]);

  const reveal = useCallback(
    async (userConfirmed: boolean) => {
      if (stranded === null) return;
      if (userConfirmed !== true) {
        setError('Key reveal requires explicit confirmation.');
        return;
      }

      setIsRevealing(true);
      setError(null);
      try {
        const key = await revealPrivateKeyForRecovery(stranded.handle);
        setRevealedKey(key);
        const deadline = Date.now() + AUTO_HIDE_MS;
        setHideAt(deadline);
        if (timerRef.current !== null) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(clearKey, AUTO_HIDE_MS);
      } catch (caught: unknown) {
        setError(toUserMessage(caught));
      } finally {
        setIsRevealing(false);
      }
    },
    [stranded, clearKey],
  );

  const dismiss = useCallback(() => {
    clearKey();
    dismissStranded();
  }, [clearKey, dismissStranded]);

  return {
    burnerAddress: stranded?.burnerAddress ?? null,
    reason: stranded?.reason ?? null,
    hasStrandedFunds: stranded !== null,
    // Gated on the session still existing: once it is destroyed the key is
    // withheld during render, so there is no frame where a dead session's key is
    // still on screen.
    revealedKey: stranded === null ? null : revealedKey,
    isRevealing,
    error,
    secondsUntilHide,
    reveal,
    hide: clearKey,
    dismiss,
  };
}

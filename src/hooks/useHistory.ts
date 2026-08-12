/**
 * Transaction history with cursor pagination.
 *
 * Pages accumulate into one list ("load more") rather than replacing it, because
 * a cursor-paginated source cannot jump to an arbitrary page number — there is
 * no offset to seek to. This is the tradeoff for O(page) reads and cursors that
 * stay stable when a new transaction is inserted.
 */

import { useCallback, useEffect, useState } from 'react';
import type { TransactionRecord } from '../types';
import {
  clearHistory,
  deleteTransaction,
  migrateLegacyHistory,
  readHistoryPage,
} from '../services/history.service';
import { toUserMessage } from '../services/errors';

const LEGACY_HISTORY_KEY = 'arc_tx_history';

export interface HistoryState {
  readonly items: readonly TransactionRecord[];
  readonly total: number;
  readonly hasMore: boolean;
  readonly isLoading: boolean;
  readonly error: string | null;
  loadMore: () => void;
  reload: () => void;
  clearAll: () => Promise<void>;
  remove: (id: number) => Promise<void>;
}

export function useHistory(chainId: number, sender: string | null): HistoryState {
  const [items, setItems] = useState<readonly TransactionRecord[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => {
    setItems([]);
    setCursor(null);
    setHasMore(false);
    setReloadToken((token) => token + 1);
  }, []);

  // First page, plus the one-time migration of any v1 localStorage history.
  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      setIsLoading(true);
      try {
        if (sender !== null) {
          await migrateLegacyHistory(LEGACY_HISTORY_KEY, { chainId, sender }).catch(() => 0);
        }
        const page = await readHistoryPage(chainId, null);
        if (cancelled) return;
        setItems(page.items);
        setCursor(page.nextCursor);
        setHasMore(page.nextCursor !== null);
        setTotal(page.total);
        setError(null);
      } catch (caught: unknown) {
        if (!cancelled) setError(toUserMessage(caught));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [chainId, sender, reloadToken]);

  const loadMore = useCallback(() => {
    if (cursor === null || isLoading) return;

    const load = async (): Promise<void> => {
      setIsLoading(true);
      try {
        const page = await readHistoryPage(chainId, cursor);
        setItems((previous) => {
          // Deduplicate defensively: a concurrent insert between pages could
          // otherwise surface the same row twice.
          const seen = new Set(previous.map((entry) => entry.id));
          return [...previous, ...page.items.filter((entry) => !seen.has(entry.id))];
        });
        setCursor(page.nextCursor);
        setHasMore(page.nextCursor !== null);
        setTotal(page.total);
        setError(null);
      } catch (caught: unknown) {
        setError(toUserMessage(caught));
      } finally {
        setIsLoading(false);
      }
    };

    void load();
  }, [chainId, cursor, isLoading]);

  const clearAll = useCallback(async () => {
    await clearHistory(chainId);
    setItems([]);
    setCursor(null);
    setHasMore(false);
    setTotal(0);
  }, [chainId]);

  const remove = useCallback(async (id: number) => {
    await deleteTransaction(id);
    setItems((previous) => previous.filter((entry) => entry.id !== id));
    setTotal((previous) => Math.max(0, previous - 1));
  }, []);

  return { items, total, hasMore, isLoading, error, loadMore, reload, clearAll, remove };
}

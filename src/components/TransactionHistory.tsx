import { useState } from 'react';
import type { ChainConfig, TransactionRecord } from '../types';
import { ICONS } from '../config/constants';
import { explorerTxUrl } from '../config/chains';
import type { HistoryState } from '../hooks/useHistory';

interface Props {
  readonly chain: ChainConfig;
  readonly history: HistoryState;
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    dateStyle: 'short',
    timeStyle: 'medium',
  });
}

function statusLabel(record: TransactionRecord): string {
  switch (record.status) {
    case 'confirmed':
      return 'Confirmed';
    case 'pending':
      return 'Pending';
    case 'failed':
      return 'Failed';
    case 'aborted':
      return 'Aborted';
  }
}

/**
 * Cursor-paginated history.
 *
 * "Load more" rather than numbered pages: the IndexedDB source is
 * cursor-addressed, so there is no offset to jump to. See
 * `history.service.ts` for why that tradeoff is deliberate.
 */
export function TransactionHistory({ chain, history }: Props): React.JSX.Element {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  return (
    <section className="section-divider stack" style={{ gap: 'var(--space-3)' }}>
      <div className="row-between">
        <h2 className="section-title">
          {ICONS.history} History{history.total > 0 && ` (${history.total})`}
        </h2>
        {history.items.length > 0 && (
          <button
            type="button"
            className="btn btn--chip"
            onClick={() => {
              if (window.confirm(`Delete all ${chain.name} transaction history?`)) {
                void history.clearAll();
              }
            }}
          >
            Clear all
          </button>
        )}
      </div>

      {history.error !== null && (
        <div className="callout callout--warning">
          <span className="callout__icon">{ICONS.warning}</span>
          <span style={{ fontSize: 13 }}>{history.error}</span>
        </div>
      )}

      {history.items.length === 0 ? (
        history.isLoading ? (
          <div className="stack" style={{ gap: 'var(--space-2)' }}>
            <span className="skeleton" style={{ height: 48 }} />
            <span className="skeleton" style={{ height: 48 }} />
          </div>
        ) : (
          <p
            className="hint"
            style={{ margin: 0, textAlign: 'center', padding: 'var(--space-4) 0' }}
          >
            No transactions on {chain.name} yet.
          </p>
        )
      ) : (
        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-2)',
          }}
        >
          {history.items.map((record) => {
            const isOpen = expandedId === record.id;
            return (
              <li key={record.id}>
                <button
                  type="button"
                  className="history-item"
                  onClick={() => setExpandedId(isOpen ? null : record.id)}
                  aria-expanded={isOpen}
                >
                  <div className="row-between">
                    <span className="row" style={{ gap: 'var(--space-2)', minWidth: 0 }}>
                      <span className={`badge badge--${record.status}`}>{statusLabel(record)}</span>
                      <span style={{ fontSize: 14, fontWeight: 500 }}>
                        {record.amount} {record.symbol}
                        {record.tokenId !== null && ` #${record.tokenId}`}
                      </span>
                    </span>
                    <span className="hint">{formatTimestamp(record.timestamp)}</span>
                  </div>

                  {isOpen && (
                    <div className="history-item__meta">
                      <span className="mono">To: {record.recipient}</span>
                      {record.hash.length > 0 ? (
                        <a
                          className="mono"
                          href={explorerTxUrl(chain, record.hash)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(event) => event.stopPropagation()}
                        >
                          {record.hash} {ICONS.external}
                        </a>
                      ) : (
                        <span className="hint">No hash recorded (never broadcast).</span>
                      )}
                      {record.burner.length > 0 && (
                        <span className="mono">Burner: {record.burner}</span>
                      )}
                      {record.blockNumber !== null && <span>Block: {record.blockNumber}</span>}
                      {record.gasUsed !== null && <span>Gas used: {record.gasUsed}</span>}
                      {record.errorMessage !== null && (
                        <span style={{ color: 'var(--danger-text)' }}>{record.errorMessage}</span>
                      )}
                    </div>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {history.hasMore && (
        <button
          type="button"
          className="btn btn--ghost"
          style={{ alignSelf: 'center' }}
          disabled={history.isLoading}
          onClick={history.loadMore}
        >
          {history.isLoading ? 'Loading…' : 'Load more'}
        </button>
      )}
    </section>
  );
}

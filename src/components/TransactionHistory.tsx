import { useState } from 'react';
import { History, Trash2, ExternalLink, ChevronDown, ChevronUp, AlertTriangle, Loader2 } from 'lucide-react';
import type { ChainConfig, TransactionRecord } from '../types';
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
    case 'confirmed': return 'Confirmed';
    case 'pending': return 'Pending';
    case 'failed': return 'Failed';
    case 'aborted': return 'Aborted';
  }
}

export function TransactionHistory({ chain, history }: Props): React.JSX.Element {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  return (
    <section className="section-divider stack" style={{ gap: 'var(--space-4)' }}>
      <div className="row-between">
        <h2 className="section-title row" style={{ gap: 8 }}>
          <History size={16} aria-hidden="true" />
          History{history.total > 0 && ` (${history.total})`}
        </h2>
        {history.items.length > 0 && (
          <button
            type="button"
            className="btn btn--chip"
            style={{ gap: 4 }}
            onClick={() => {
              if (window.confirm(`Delete all ${chain.name} transaction history?`)) {
                void history.clearAll();
              }
            }}
          >
            <Trash2 size={10} aria-hidden="true" />
            Clear all
          </button>
        )}
      </div>

      {history.error !== null && (
        <div className="callout callout--warning">
          <span className="callout__icon">
            <AlertTriangle size={16} aria-hidden="true" />
          </span>
          <span style={{ fontSize: 13 }}>{history.error}</span>
        </div>
      )}

      {history.items.length === 0 ? (
        history.isLoading ? (
          <div className="stack" style={{ gap: 'var(--space-2)' }}>
            <span className="skeleton" style={{ height: 52, borderRadius: 'var(--radius-lg)' }} />
            <span className="skeleton" style={{ height: 52, borderRadius: 'var(--radius-lg)' }} />
          </div>
        ) : (
          <div
            style={{
              textAlign: 'center',
              padding: 'var(--space-10) var(--space-4)',
              color: 'var(--muted)',
            }}
          >
            <History size={28} aria-hidden="true" style={{ marginBottom: 'var(--space-3)', opacity: 0.35 }} />
            <p style={{ fontSize: 14, margin: 0 }}>No transactions on {chain.name} yet.</p>
          </div>
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
                      <span className={`badge badge--${record.status}`}>
                        {statusLabel(record)}
                      </span>
                      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
                        {record.amount} {record.symbol}
                        {record.tokenId !== null && (
                          <span style={{ color: 'var(--muted)', fontWeight: 400 }}> #{record.tokenId}</span>
                        )}
                      </span>
                    </span>
                    <span className="row" style={{ gap: 6, flexShrink: 0 }}>
                      <span className="hint">{formatTimestamp(record.timestamp)}</span>
                      {isOpen
                        ? <ChevronUp size={13} aria-hidden="true" style={{ color: 'var(--muted)' }} />
                        : <ChevronDown size={13} aria-hidden="true" style={{ color: 'var(--muted)' }} />}
                    </span>
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
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                        >
                          {record.hash.slice(0, 18)}…{record.hash.slice(-6)}
                          <ExternalLink size={10} aria-hidden="true" />
                        </a>
                      ) : (
                        <span className="hint">No hash recorded (never broadcast).</span>
                      )}
                      {record.burner.length > 0 && (
                        <span className="mono" style={{ color: 'var(--muted)' }}>
                          Burner: {record.burner.slice(0, 10)}…{record.burner.slice(-6)}
                        </span>
                      )}
                      {record.blockNumber !== null && (
                        <span style={{ fontVariantNumeric: 'tabular-nums' }}>Block: {record.blockNumber}</span>
                      )}
                      {record.gasUsed !== null && (
                        <span style={{ fontVariantNumeric: 'tabular-nums' }}>Gas used: {record.gasUsed.toLocaleString()}</span>
                      )}
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
          style={{ alignSelf: 'center', gap: 6 }}
          disabled={history.isLoading}
          onClick={history.loadMore}
        >
          {history.isLoading
            ? <><Loader2 size={13} aria-hidden="true" className="spinner" /> Loading…</>
            : 'Load more'}
        </button>
      )}
    </section>
  );
}

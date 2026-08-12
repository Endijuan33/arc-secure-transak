import type { ChainConfig, TokenBalance } from '../types';

interface Props {
  readonly isConnected: boolean;
  readonly chain: ChainConfig;
  readonly native: TokenBalance | null;
  readonly isLoading: boolean;
  readonly isWrongNetwork: boolean;
  readonly onSwitchNetwork: () => void;
}

export function AccountInfo({
  isConnected,
  chain,
  native,
  isLoading,
  isWrongNetwork,
  onSwitchNetwork,
}: Props): React.JSX.Element | null {
  if (!isConnected) return null;

  return (
    <div className="stack" style={{ gap: 'var(--space-3)', marginBottom: 'var(--space-6)' }}>
      <div
        className="row-between"
        style={{
          background: 'var(--bg-surface-sunken)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-lg)',
          padding: 'var(--space-3) var(--space-4)',
          fontSize: 13,
          flexWrap: 'wrap',
          rowGap: 'var(--space-2)',
        }}
      >
        <span style={{ color: 'var(--text-muted)' }}>
          Network <strong style={{ color: 'var(--text-primary)' }}>{chain.name}</strong>
        </span>
        <span style={{ color: 'var(--text-muted)' }}>
          Balance{' '}
          {isLoading && native === null ? (
            <span className="skeleton" style={{ display: 'inline-block', width: 90, height: 14 }} />
          ) : (
            <strong style={{ color: 'var(--text-primary)' }}>
              {native?.formatted ?? '0'} {chain.nativeCurrency.symbol}
            </strong>
          )}
        </span>
      </div>

      {isWrongNetwork && (
        <div className="callout callout--warning">
          <span className="callout__icon">⚠️</span>
          <div style={{ flex: 1 }}>
            <strong style={{ display: 'block' }}>Wrong network</strong>
            <span style={{ fontSize: 13 }}>
              Your wallet is on a different chain. Switch to {chain.name} before sending.
            </span>
          </div>
          <button type="button" className="btn btn--chip" onClick={onSwitchNetwork}>
            Switch
          </button>
        </div>
      )}
    </div>
  );
}

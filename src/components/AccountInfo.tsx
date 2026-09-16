import { Network, Coins, AlertTriangle, ArrowLeftRight } from 'lucide-react';
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
          background: 'var(--surface-strong)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          padding: 'var(--space-3) var(--space-4)',
          flexWrap: 'wrap',
          rowGap: 'var(--space-2)',
        }}
      >
        <span
          className="row"
          style={{ gap: 'var(--space-2)', fontSize: 13, color: 'var(--muted)' }}
        >
          <Network size={13} aria-hidden="true" style={{ flexShrink: 0 }} />
          <span>
            Network <strong style={{ color: 'var(--ink)', fontWeight: 600 }}>{chain.name}</strong>
            {chain.testnet && (
              <span
                style={{
                  marginLeft: 6,
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                  color: 'var(--warning-text)',
                  background: 'var(--warning-soft)',
                  padding: '1px 5px',
                  borderRadius: 'var(--radius-pill)',
                  border: '1px solid var(--warning)',
                }}
              >
                testnet
              </span>
            )}
          </span>
        </span>

        <span
          className="row"
          style={{ gap: 'var(--space-2)', fontSize: 13, color: 'var(--muted)' }}
        >
          <Coins size={13} aria-hidden="true" style={{ flexShrink: 0 }} />
          <span>
            Balance{' '}
            {isLoading && native === null ? (
              <span
                className="skeleton"
                style={{
                  display: 'inline-block',
                  width: 88,
                  height: 14,
                  verticalAlign: 'middle',
                  borderRadius: 4,
                }}
              />
            ) : (
              <strong
                style={{
                  color: 'var(--ink)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 13,
                  fontVariantNumeric: 'tabular-nums',
                  fontWeight: 600,
                }}
              >
                {native?.formatted ?? '0'} {chain.nativeCurrency.symbol}
              </strong>
            )}
          </span>
        </span>
      </div>

      {isWrongNetwork && (
        <div className="callout callout--warning" style={{ alignItems: 'center' }}>
          <span className="callout__icon">
            <AlertTriangle size={16} aria-hidden="true" />
          </span>
          <div style={{ flex: 1 }}>
            <strong style={{ display: 'block', marginBottom: 1 }}>Wrong network</strong>
            <span style={{ fontSize: 13 }}>
              Your wallet is connected to a different chain. Switch to {chain.name} to continue.
            </span>
          </div>
          <button
            type="button"
            className="btn btn--chip"
            onClick={onSwitchNetwork}
            style={{ flexShrink: 0, gap: 4 }}
          >
            <ArrowLeftRight size={10} aria-hidden="true" />
            Switch
          </button>
        </div>
      )}
    </div>
  );
}

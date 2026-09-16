import { formatUnits } from 'ethers';
import { Fuel } from 'lucide-react';
import type { ChainConfig, GasSpeed, TokenBalance } from '../types';
import type { GasQuoteState } from '../hooks/useGas';

interface Props {
  readonly asset: TokenBalance | null;
  readonly amount: string;
  readonly chain: ChainConfig;
  readonly gasSpeed: GasSpeed;
  readonly gas: GasQuoteState;
  readonly onAmountChange: (value: string) => void;
  readonly onGasSpeedChange: (speed: GasSpeed) => void;
  readonly onMax: () => void;
}

const GAS_SPEEDS: readonly { readonly id: GasSpeed; readonly label: string }[] = [
  { id: 'standard', label: 'Standard' },
  { id: 'fast', label: 'Fast' },
  { id: 'instant', label: 'Instant' },
];

function sanitizeAmountInput(raw: string): string {
  const unified = raw.replace(/,/g, '.').replace(/[^0-9.]/g, '');
  const firstDot = unified.indexOf('.');
  if (firstDot === -1) return unified;
  return `${unified.slice(0, firstDot + 1)}${unified.slice(firstDot + 1).replace(/\./g, '')}`;
}

export function AmountInput({
  asset,
  amount,
  chain,
  gasSpeed,
  gas,
  onAmountChange,
  onGasSpeedChange,
  onMax,
}: Props): React.JSX.Element | null {
  if (asset === null) return null;

  const estimate = gas.estimate;
  const feePerGas = estimate === null ? null : formatUnits(estimate.fee.effectiveGasPrice, 'gwei');

  return (
    <div className="stack" style={{ gap: 'var(--space-3)' }}>
      {/* Amount field */}
      <div>
        <div className="row-between" style={{ marginBottom: 'var(--space-2)' }}>
          <span className="label" style={{ marginBottom: 0 }}>
            Amount
          </span>
          <button type="button" className="btn btn--chip" onClick={onMax}>
            MAX
          </button>
        </div>
        <div style={{ position: 'relative' }}>
          <input
            type="text"
            inputMode="decimal"
            className="input input--mono"
            placeholder={`0.00`}
            value={amount}
            onChange={(event) => onAmountChange(sanitizeAmountInput(event.target.value))}
            aria-label={`Amount of ${asset.symbol} to send`}
            style={{ paddingRight: 72, fontSize: 18, fontWeight: 600 }}
          />
          <span
            style={{
              position: 'absolute',
              right: 14,
              top: '50%',
              transform: 'translateY(-50%)',
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--muted)',
              pointerEvents: 'none',
            }}
          >
            {asset.symbol}
          </span>
        </div>
        <p className="hint" style={{ margin: 'var(--space-2) 0 0' }}>
          Available:{' '}
          <span style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
            {asset.formatted} {asset.symbol}
          </span>
        </p>
      </div>

      {/* Fee priority */}
      <div className="row-between" style={{ flexWrap: 'wrap', rowGap: 'var(--space-2)' }}>
        <span className="row" style={{ gap: 6 }}>
          <Fuel size={13} aria-hidden="true" style={{ color: 'var(--muted)' }} />
          <span className="label" style={{ marginBottom: 0 }}>
            Fee priority
          </span>
        </span>
        <div className="segmented" role="group" aria-label="Fee priority">
          {GAS_SPEEDS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`segmented__option${gasSpeed === entry.id ? ' segmented__option--active' : ''}`}
              onClick={() => onGasSpeedChange(entry.id)}
              aria-pressed={gasSpeed === entry.id}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </div>

      {/* Gas estimate panel */}
      <div className="surface-sunken" style={{ fontSize: 12 }} aria-live="polite">
        {gas.isLoading && estimate === null ? (
          <span className="skeleton" style={{ display: 'block', width: '65%', height: 13 }} />
        ) : gas.error !== null ? (
          <span style={{ color: 'var(--warning-text)' }}>
            Fee estimate unavailable — {gas.error}
          </span>
        ) : estimate === null ? (
          <span style={{ color: 'var(--muted)' }}>
            Enter a recipient and amount to see the fee estimate.
          </span>
        ) : (
          <div className="stack" style={{ gap: 4 }}>
            <div className="row-between">
              <span style={{ color: 'var(--muted)' }}>Gas limit</span>
              <span
                style={{
                  color: 'var(--ink-2)',
                  fontFamily: 'var(--font-mono)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {estimate.gasLimit.toString()}
                {!estimate.simulated && (
                  <span style={{ color: 'var(--warning-text)', marginLeft: 6 }}>approx</span>
                )}
              </span>
            </div>
            <div className="row-between">
              <span style={{ color: 'var(--muted)' }}>Gas price</span>
              <span
                style={{
                  color: 'var(--ink-2)',
                  fontFamily: 'var(--font-mono)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {Number(feePerGas ?? '0').toFixed(3)} gwei
              </span>
            </div>
            <div
              className="row-between"
              style={{ borderTop: '1px solid var(--border)', paddingTop: 6, marginTop: 2 }}
            >
              <span style={{ color: 'var(--muted)' }}>Burner funding</span>
              <span
                style={{
                  color: 'var(--ink)',
                  fontWeight: 600,
                  fontFamily: 'var(--font-mono)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {gas.fundingFormatted === null
                  ? '—'
                  : `${Number(gas.fundingFormatted).toFixed(6)} ${chain.nativeCurrency.symbol}`}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

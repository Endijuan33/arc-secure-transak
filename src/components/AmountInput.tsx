import { formatUnits } from 'ethers';
import type { ChainConfig, GasSpeed, TokenBalance } from '../types';
import { ICONS } from '../config/constants';
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

/**
 * Keep only characters that can form a decimal number.
 *
 * Commas become dots so both locale conventions work, and only the first dot
 * survives so `1.2.3` cannot be typed. Full validation still happens in
 * `validateAmount`; this is purely to keep the field from accepting text that
 * could never be valid.
 */
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
      <div>
        <div className="row-between" style={{ marginBottom: 'var(--space-2)' }}>
          <span className="label" style={{ marginBottom: 0 }}>
            {ICONS.amount} Amount of {asset.symbol}
          </span>
          <button type="button" className="btn btn--chip" onClick={onMax}>
            MAX
          </button>
        </div>
        <input
          type="text"
          inputMode="decimal"
          className="input input--mono"
          placeholder={`0.0 ${asset.symbol}`}
          value={amount}
          onChange={(event) => onAmountChange(sanitizeAmountInput(event.target.value))}
          aria-label={`Amount of ${asset.symbol} to send`}
        />
        <p className="hint" style={{ margin: 'var(--space-2) 0 0' }}>
          Available: {asset.formatted} {asset.symbol}
        </p>
      </div>

      <div className="row-between" style={{ flexWrap: 'wrap', rowGap: 'var(--space-2)' }}>
        <span className="label" style={{ marginBottom: 0 }}>
          {ICONS.gas} Fee priority
        </span>
        <div className="segmented" role="group" aria-label="Fee priority">
          {GAS_SPEEDS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`segmented__option${
                gasSpeed === entry.id ? ' segmented__option--active' : ''
              }`}
              onClick={() => onGasSpeedChange(entry.id)}
              aria-pressed={gasSpeed === entry.id}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </div>

      <div
        className="panel"
        style={{ padding: 'var(--space-3) var(--space-4)', fontSize: 12 }}
        aria-live="polite"
      >
        {gas.isLoading && estimate === null ? (
          <span className="skeleton" style={{ display: 'block', width: '70%', height: 14 }} />
        ) : gas.error !== null ? (
          <span style={{ color: 'var(--warning-text)' }}>
            Fee estimate unavailable: {gas.error}
          </span>
        ) : estimate === null ? (
          <span style={{ color: 'var(--text-muted)' }}>
            Enter a valid recipient and amount to see the fee estimate.
          </span>
        ) : (
          <div className="stack" style={{ gap: 'var(--space-1)' }}>
            <span style={{ color: 'var(--text-secondary)' }}>
              Gas limit <strong>{estimate.gasLimit.toString()}</strong> at{' '}
              <strong>{Number(feePerGas ?? '0').toFixed(3)} gwei</strong>
              {!estimate.simulated && ' (fallback estimate)'}
            </span>
            <span style={{ color: 'var(--text-secondary)' }}>
              Burner funding{' '}
              <strong>
                {gas.fundingFormatted === null
                  ? '—'
                  : `${Number(gas.fundingFormatted).toFixed(6)} ${chain.nativeCurrency.symbol}`}
              </strong>{' '}
              <span style={{ color: 'var(--text-muted)' }}>
                (covers the transfer, the sweep back, and a safety buffer)
              </span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

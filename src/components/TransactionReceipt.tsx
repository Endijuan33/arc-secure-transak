import { CheckCircle, AlertTriangle, ExternalLink } from 'lucide-react';
import type { ChainConfig, TransactionStatus } from '../types';
import { explorerAddressUrl, explorerTxUrl } from '../config/chains';
import type { TransakResult } from '../services/transak.service';

interface Props {
  readonly status: TransactionStatus | 'idle';
  readonly chain: ChainConfig;
  readonly result: TransakResult | null;
  readonly amount: string;
  readonly symbol: string;
  readonly recipient: string;
}

function shorten(value: string): string {
  return value.length > 20 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value;
}

export function TransactionReceipt({
  status,
  chain,
  result,
  amount,
  symbol,
  recipient,
}: Props): React.JSX.Element | null {
  if (result === null || status === 'idle') return null;

  const settled = status === 'confirmed';

  return (
    <section
      className={`receipt receipt--${settled ? 'confirmed' : 'attention'}`}
      aria-label="Transfer receipt"
    >
      <header className="receipt__head">
        <span className="receipt__icon">
          {settled ? (
            <CheckCircle size={18} aria-hidden="true" />
          ) : (
            <AlertTriangle size={18} aria-hidden="true" />
          )}
        </span>
        <div style={{ minWidth: 0 }}>
          <strong className="receipt__title">
            {settled ? 'Transfer complete' : 'Transfer needs attention'}
          </strong>
          <span className="receipt__amount">
            {amount} {symbol}
          </span>
        </div>
      </header>

      <dl className="receipt__grid">
        <div className="receipt__cell">
          <dt>Recipient</dt>
          <dd>
            <a
              className="mono"
              href={explorerAddressUrl(chain, recipient)}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              {shorten(recipient)}
              <ExternalLink size={10} aria-hidden="true" />
            </a>
          </dd>
        </div>

        <div className="receipt__cell">
          <dt>Block</dt>
          <dd className="mono" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {result.blockNumber ?? '—'}
          </dd>
        </div>

        <div className="receipt__cell">
          <dt>Gas used</dt>
          <dd className="mono" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {result.gasUsed?.toLocaleString() ?? '—'}
          </dd>
        </div>

        <div className="receipt__cell">
          <dt>Unused gas</dt>
          <dd>{result.refunded ? 'Returned to you' : 'Below sweep cost'}</dd>
        </div>

        <div className="receipt__cell receipt__cell--wide">
          <dt>Burner used</dt>
          <dd>
            <a
              className="mono"
              href={explorerAddressUrl(chain, result.burnerAddress)}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              {shorten(result.burnerAddress)}
              <ExternalLink size={10} aria-hidden="true" />
            </a>
            <span className="hint" style={{ display: 'block', marginTop: 2 }}>
              Key destroyed. This address will never be reused.
            </span>
          </dd>
        </div>

        <div className="receipt__cell receipt__cell--wide">
          <dt>Transaction</dt>
          <dd>
            <a
              className="mono"
              href={explorerTxUrl(chain, result.hash)}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}
            >
              {shorten(result.hash)}
              <ExternalLink size={10} aria-hidden="true" />
            </a>
          </dd>
        </div>
      </dl>

      <p className="receipt__footnote">
        Your wallet never signed a transaction addressed to the recipient. Verify on{' '}
        <a
          href={explorerAddressUrl(chain, result.burnerAddress)}
          target="_blank"
          rel="noopener noreferrer"
        >
          {chain.explorer.name}
        </a>{' '}
        that the only approvals you gave were to the burner above.
      </p>
    </section>
  );
}

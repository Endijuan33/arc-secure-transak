import type { ChainConfig, TransactionStatus } from '../types';
import { ICONS } from '../config/constants';
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

/**
 * Post-transfer receipt.
 *
 * Replaces the bare hash link with the facts a user needs to reconcile the
 * transfer independently: what moved, where it went, which block confirmed it,
 * what it cost, and whether the burner was emptied. Every address and hash links
 * to the explorer, so nothing here has to be taken on trust.
 */
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
        <span className="receipt__icon" aria-hidden="true">
          {settled ? ICONS.check : ICONS.warning}
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
            >
              {shorten(recipient)}
            </a>
          </dd>
        </div>

        <div className="receipt__cell">
          <dt>Block</dt>
          <dd className="mono">{result.blockNumber ?? '—'}</dd>
        </div>

        <div className="receipt__cell">
          <dt>Gas used</dt>
          <dd className="mono">{result.gasUsed?.toLocaleString() ?? '—'}</dd>
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
            >
              {shorten(result.burnerAddress)}
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
              style={{ fontSize: 12 }}
            >
              {result.hash} {ICONS.external}
            </a>
          </dd>
        </div>
      </dl>

      <p className="receipt__footnote">
        Your wallet never signed a transaction addressed to the recipient. Verify on{' '}
        {chain.explorer.name} that the only approvals you gave were to the burner above.
      </p>
    </section>
  );
}

import type { ChainConfig } from '../types';
import { ICONS } from '../config/constants';
import { PIPELINE_DEFINITIONS } from '../store/pipeline';

interface Props {
  readonly chain: ChainConfig;
}

/**
 * Project documentation, rendered in the app.
 *
 * A tool that asks users to route funds through a key it generates has to explain
 * itself in the interface, not only in a README the user will never open. This
 * panel states the threat model, the guarantee, the mechanism, and — deliberately
 * — what the tool does *not* protect against.
 *
 * The limitations section is not a disclaimer for our benefit. A user who believes
 * this eliminates all risk will take risks they should not; being specific about
 * the residual exposure is part of the product working correctly.
 */
export function AboutPanel({ chain }: Props): React.JSX.Element {
  return (
    <div className="stack" style={{ gap: 'var(--space-6)' }}>
      <section className="stack" style={{ gap: 'var(--space-3)' }}>
        <h2 className="section-title">What this tool does</h2>
        <p className="prose">
          Arc Secure Transak moves native coins, ERC-20 tokens, and NFTs to a destination{' '}
          <strong>without your wallet ever signing a transaction addressed to that destination</strong>.
        </p>
        <p className="prose">
          A normal transfer to a malicious contract is dangerous because your wallet signs a
          transaction sent <em>to</em> that contract. Anything it does — draining an approval,
          re-entering, front-running — happens with your address as the caller. This tool inserts a
          disposable intermediary so that call never originates from you.
        </p>
      </section>

      <section className="stack" style={{ gap: 'var(--space-3)' }}>
        <h2 className="section-title">The guarantee</h2>
        <div className="callout callout--success">
          <span className="callout__icon">{ICONS.shield}</span>
          <div>
            <strong style={{ display: 'block', marginBottom: 4 }}>
              Your wallet signs at most two transactions, both to addresses this app controls.
            </strong>
            <span style={{ fontSize: 13 }}>
              If the recipient turns out to be hostile, the most it can take is the amount
              deliberately placed in the burner. Your main wallet granted no approval to it and
              signed nothing addressed to it.
            </span>
          </div>
        </div>
      </section>

      <section className="stack" style={{ gap: 'var(--space-3)' }}>
        <h2 className="section-title">How the key is handled</h2>
        <ul className="feature-list">
          <li>
            <strong>Generated in memory.</strong> A fresh secp256k1 key per transfer, from the
            browser's CSPRNG.
          </li>
          <li>
            <strong>Encrypted at rest in memory.</strong> AES-256-GCM under a non-extractable
            <code> CryptoKey</code>. Plaintext exists only inside the microseconds of a signing call.
          </li>
          <li>
            <strong>Overwritten, not just dropped.</strong> Key buffers are filled with random bytes
            then zeros, in a <code>finally</code> block so an exception cannot leak a live buffer.
          </li>
          <li>
            <strong>Never persisted.</strong> No localStorage, sessionStorage, IndexedDB, cookies, or
            console output. Closing the tab destroys it.
          </li>
          <li>
            <strong>Destroyed only when empty.</strong> The key is wiped after the burner's balance
            is verified drained — never while assets remain.
          </li>
        </ul>
        <p className="hint" style={{ margin: 0 }}>
          Requires HTTPS or localhost. Without a secure context the browser withholds
          <code> crypto.subtle</code> and the app refuses to operate rather than storing a key
          unencrypted.
        </p>
      </section>

      <section className="stack" style={{ gap: 'var(--space-3)' }}>
        <h2 className="section-title">The ten stages</h2>
        <ol className="stage-list">
          {PIPELINE_DEFINITIONS.map((definition, index) => (
            <li key={definition.id} className="stage-list__item">
              <span className="stage-list__index">{index + 1}</span>
              <div>
                <span className="stage-list__label">
                  {definition.label}
                  {definition.signature && <span className="tag tag--signature">signature</span>}
                </span>
                <p className="stage-list__summary">{definition.summary}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="stack" style={{ gap: 'var(--space-3)' }}>
        <h2 className="section-title">If something goes wrong</h2>
        <p className="prose">
          Any failure after the burner is funded triggers recovery: the asset is returned first, then
          the remaining gas. Recovery runs even when you press abort, because honouring the
          cancellation there would strand the funds.
        </p>
        <p className="prose">
          If recovery cannot move the assets, the app does not pretend to succeed. It keeps the
          burner key alive and shows a recovery panel where you can reveal it — behind an explicit
          confirmation, auto-hidden after 60 seconds, never logged.
        </p>
      </section>

      <section className="stack" style={{ gap: 'var(--space-3)' }}>
        <h2 className="section-title">What this does not protect against</h2>
        <div className="callout callout--warning">
          <span className="callout__icon">{ICONS.warning}</span>
          <div className="stack" style={{ gap: 'var(--space-2)' }}>
            <span style={{ fontSize: 13 }}>
              <strong>Sending to the wrong address.</strong> The burner routes your transfer
              faithfully. It cannot know the destination was a typo.
            </span>
            <span style={{ fontSize: 13 }}>
              <strong>A token contract that lies.</strong> A <code>transfer</code> returning success
              without moving anything produces a valid receipt. No client-side check detects this.
            </span>
            <span style={{ fontSize: 13 }}>
              <strong>Losing the tab mid-transfer.</strong> Between funding and dispatch the assets
              sit with a key held only in this tab's memory. If the tab dies there, recovery cannot
              run.
            </span>
            <span style={{ fontSize: 13 }}>
              <strong>A compromised device or browser extension.</strong> Anything that can read this
              page's memory can read the key while it is decrypted.
            </span>
          </div>
        </div>
      </section>

      <section className="stack" style={{ gap: 'var(--space-3)' }}>
        <h2 className="section-title">Cost of the extra safety</h2>
        <p className="prose">
          Routing through a burner costs one additional native transfer of gas versus sending
          directly — the funding transaction, plus the sweep that returns what is unused. A small
          remainder stays in each burner because a node requires the full worst-case fee to be
          available before it will accept the sweep, and the EIP-1559 refund arrives afterwards.
          On {chain.name} that remainder is a fraction of a cent.
        </p>
      </section>

      <section className="stack" style={{ gap: 'var(--space-2)' }}>
        <h2 className="section-title">Network</h2>
        <dl className="receipt__grid">
          <div className="receipt__cell">
            <dt>Chain</dt>
            <dd>
              {chain.name}
              {chain.testnet && ' (testnet)'}
            </dd>
          </div>
          <div className="receipt__cell">
            <dt>Chain ID</dt>
            <dd className="mono">{chain.id}</dd>
          </div>
          <div className="receipt__cell">
            <dt>Native asset</dt>
            <dd>{chain.nativeCurrency.symbol}</dd>
          </div>
          <div className="receipt__cell">
            <dt>RPC endpoints</dt>
            <dd>{chain.rpcEndpoints.length} with automatic failover</dd>
          </div>
          <div className="receipt__cell receipt__cell--wide">
            <dt>Explorer</dt>
            <dd>
              <a href={chain.explorer.url} target="_blank" rel="noopener noreferrer">
                {chain.explorer.name} {ICONS.external}
              </a>
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}

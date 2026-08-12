import { useState } from 'react';
import { ICONS } from '../config/constants';
import { explorerAddressUrl } from '../config/chains';
import type { ChainConfig } from '../types';
import type { BurnerRecoveryState } from '../hooks/useBurnerWallet';

interface Props {
  readonly chain: ChainConfig;
  readonly recovery: BurnerRecoveryState;
}

/**
 * Last-resort recovery panel.
 *
 * Only rendered when the pipeline could not sweep the burner. The private key is
 * behind a two-stage gate: the user must expand the danger section and then tick
 * an explicit acknowledgement before the reveal button becomes usable. Nothing
 * here writes to the console, to storage, or to the network.
 */
export function BurnerRecoveryPanel({ chain, recovery }: Props): React.JSX.Element | null {
  const [showDanger, setShowDanger] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!recovery.hasStrandedFunds || recovery.burnerAddress === null) return null;

  const burner = recovery.burnerAddress;

  return (
    <section className="callout callout--error stack" style={{ gap: 'var(--space-3)' }}>
      <div className="row" style={{ alignItems: 'flex-start', gap: 'var(--space-3)' }}>
        <span className="callout__icon">{ICONS.warning}</span>
        <div style={{ minWidth: 0 }}>
          <strong style={{ display: 'block', marginBottom: 2 }}>Assets need manual recovery</strong>
          <span style={{ fontSize: 13 }}>
            {recovery.reason ?? 'The automatic sweep did not complete.'}
          </span>
        </div>
      </div>

      <div className="panel stack" style={{ gap: 'var(--space-2)' }}>
        <span className="hint">Burner address holding your assets</span>
        <a
          className="mono"
          href={explorerAddressUrl(chain, burner)}
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: 12 }}
        >
          {burner}
        </a>
        <p className="hint" style={{ margin: 0 }}>
          Check the explorer first. If the transfer actually landed, no recovery is needed and you
          can dismiss this panel.
        </p>
      </div>

      {!showDanger ? (
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn--chip" onClick={() => setShowDanger(true)}>
            I need the burner private key
          </button>
          <button type="button" className="btn btn--ghost" onClick={recovery.dismiss}>
            Dismiss and wipe key
          </button>
        </div>
      ) : (
        <div className="panel stack" style={{ gap: 'var(--space-3)' }}>
          <strong style={{ color: 'var(--danger-text)' }}>Danger zone</strong>
          <p className="hint" style={{ margin: 0 }}>
            Revealing the key removes the encryption protecting it. Anyone who sees your screen, a
            screen recording, or your clipboard can drain this burner. Import it into a wallet, move
            the assets out, and never reuse it. This panel is the only copy — closing the tab
            destroys the key permanently.
          </p>

          <label className="row" style={{ fontSize: 13, alignItems: 'flex-start', gap: 8 }}>
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            <span>I understand the risk and want to reveal the key now.</span>
          </label>

          {recovery.revealedKey === null ? (
            <button
              type="button"
              className="btn btn--danger"
              disabled={!acknowledged || recovery.isRevealing}
              onClick={() => void recovery.reveal(acknowledged)}
            >
              {recovery.isRevealing ? 'Decrypting…' : 'Reveal private key'}
            </button>
          ) : (
            <div className="stack" style={{ gap: 'var(--space-2)' }}>
              <code
                className="mono"
                style={{
                  display: 'block',
                  padding: 'var(--space-3)',
                  background: 'var(--bg-surface-sunken)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 12,
                  userSelect: 'all',
                }}
              >
                {recovery.revealedKey}
              </code>
              <div className="row-between" style={{ flexWrap: 'wrap', rowGap: 'var(--space-2)' }}>
                <span className="hint">Auto-hides in {recovery.secondsUntilHide ?? 0}s</span>
                <div className="row" style={{ gap: 'var(--space-2)' }}>
                  <button
                    type="button"
                    className="btn btn--chip"
                    onClick={() => {
                      const key = recovery.revealedKey;
                      if (key === null) return;
                      void navigator.clipboard
                        .writeText(key)
                        .then(() => setCopied(true))
                        .catch(() => setCopied(false));
                    }}
                  >
                    {copied ? 'Copied' : `${ICONS.copy} Copy`}
                  </button>
                  <button type="button" className="btn btn--chip" onClick={recovery.hide}>
                    Hide now
                  </button>
                </div>
              </div>
            </div>
          )}

          {recovery.error !== null && (
            <span style={{ fontSize: 12, color: 'var(--danger-text)' }}>{recovery.error}</span>
          )}

          <button type="button" className="btn btn--ghost" onClick={recovery.dismiss}>
            Done — wipe the key from memory
          </button>
        </div>
      )}
    </section>
  );
}

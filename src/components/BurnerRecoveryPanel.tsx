import { useState } from 'react';
import { AlertTriangle, ExternalLink, Key, EyeOff, Copy, Check, Trash2 } from 'lucide-react';
import { explorerAddressUrl } from '../config/chains';
import type { ChainConfig } from '../types';
import type { BurnerRecoveryState } from '../hooks/useBurnerWallet';

interface Props {
  readonly chain: ChainConfig;
  readonly recovery: BurnerRecoveryState;
}

export function BurnerRecoveryPanel({ chain, recovery }: Props): React.JSX.Element | null {
  const [showDanger, setShowDanger] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!recovery.hasStrandedFunds || recovery.burnerAddress === null) return null;

  const burner = recovery.burnerAddress;

  return (
    <section
      className="callout callout--error stack"
      style={{ gap: 'var(--space-4)', marginBottom: 'var(--space-4)' }}
    >
      <div className="row" style={{ alignItems: 'flex-start', gap: 'var(--space-3)' }}>
        <span className="callout__icon">
          <AlertTriangle size={16} aria-hidden="true" />
        </span>
        <div style={{ minWidth: 0 }}>
          <strong style={{ display: 'block', marginBottom: 3 }}>Assets need manual recovery</strong>
          <span style={{ fontSize: 13, lineHeight: 1.55 }}>
            {recovery.reason ?? 'The automatic sweep did not complete.'}
          </span>
        </div>
      </div>

      <div className="panel stack" style={{ gap: 'var(--space-2)', background: 'var(--surface-sunken)' }}>
        <span className="hint">Burner address holding your assets</span>
        <a
          className="mono"
          href={explorerAddressUrl(chain, burner)}
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--link)' }}
        >
          {burner}
          <ExternalLink size={10} aria-hidden="true" />
        </a>
        <p className="hint" style={{ margin: 0 }}>
          Check the explorer first. If the transfer landed, no recovery is needed and you can dismiss
          this panel.
        </p>
      </div>

      {!showDanger ? (
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
          <button
            type="button"
            className="btn btn--chip"
            onClick={() => setShowDanger(true)}
            style={{ gap: 4 }}
          >
            <Key size={10} aria-hidden="true" />
            I need the burner private key
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={recovery.dismiss}
            style={{ gap: 4 }}
          >
            <Trash2 size={11} aria-hidden="true" />
            Dismiss and wipe key
          </button>
        </div>
      ) : (
        <div className="panel stack" style={{ gap: 'var(--space-3)', background: 'var(--surface-sunken)', borderColor: 'var(--danger)' }}>
          <strong style={{ color: 'var(--danger-text)', fontSize: 13 }}>
            Danger zone
          </strong>
          <p className="hint" style={{ margin: 0 }}>
            Revealing the key removes the encryption protecting it. Anyone who sees your screen, a
            screen recording, or your clipboard can drain this burner. Import it into a wallet, move
            the assets out, and never reuse it. This panel is the only copy — closing the tab
            destroys the key permanently.
          </p>

          <label
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
              style={{ marginTop: 2, flexShrink: 0 }}
            />
            <span>I understand the risk and want to reveal the key now.</span>
          </label>

          {recovery.revealedKey === null ? (
            <button
              type="button"
              className="btn btn--danger"
              disabled={!acknowledged || recovery.isRevealing}
              onClick={() => void recovery.reveal(acknowledged)}
              style={{ gap: 6 }}
            >
              <Key size={14} aria-hidden="true" />
              {recovery.isRevealing ? 'Decrypting…' : 'Reveal private key'}
            </button>
          ) : (
            <div className="stack" style={{ gap: 'var(--space-2)' }}>
              <code
                className="mono"
                style={{
                  display: 'block',
                  padding: 'var(--space-3)',
                  background: 'var(--surface-sunken)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border)',
                  fontSize: 12,
                  userSelect: 'all',
                  wordBreak: 'break-all',
                  lineHeight: 1.6,
                }}
              >
                {recovery.revealedKey}
              </code>
              <div className="row-between" style={{ flexWrap: 'wrap', rowGap: 'var(--space-2)' }}>
                <span className="hint">
                  Auto-hides in {recovery.secondsUntilHide ?? 0}s
                </span>
                <div className="row" style={{ gap: 'var(--space-2)' }}>
                  <button
                    type="button"
                    className="btn btn--chip"
                    onClick={() => {
                      const key = recovery.revealedKey;
                      if (key === null) return;
                      void navigator.clipboard
                        .writeText(key)
                        .then(() => {
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        })
                        .catch(() => setCopied(false));
                    }}
                    style={{ gap: 4 }}
                  >
                    {copied
                      ? <><Check size={10} aria-hidden="true" /> Copied</>
                      : <><Copy size={10} aria-hidden="true" /> Copy</>}
                  </button>
                  <button
                    type="button"
                    className="btn btn--chip"
                    onClick={recovery.hide}
                    style={{ gap: 4 }}
                  >
                    <EyeOff size={10} aria-hidden="true" />
                    Hide now
                  </button>
                </div>
              </div>
            </div>
          )}

          {recovery.error !== null && (
            <span style={{ fontSize: 12, color: 'var(--danger-text)' }}>{recovery.error}</span>
          )}

          <button
            type="button"
            className="btn btn--ghost"
            onClick={recovery.dismiss}
            style={{ gap: 4 }}
          >
            <Trash2 size={12} aria-hidden="true" />
            Done — wipe the key from memory
          </button>
        </div>
      )}
    </section>
  );
}

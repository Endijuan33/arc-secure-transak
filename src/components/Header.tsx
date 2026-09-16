import { Shield, Sun, Moon, Wallet, ChevronDown } from 'lucide-react';
import { SUPPORTED_CHAINS } from '../config/chains';
import type { ChainConfig, ThemeMode } from '../types';

interface Props {
  readonly isConnected: boolean;
  readonly address: string | null;
  readonly chain: ChainConfig;
  readonly theme: ThemeMode;
  readonly isSecureContext: boolean;
  readonly onOpenWallet: () => void;
  readonly onSelectChain: (chainId: number) => void;
  readonly onToggleTheme: () => void;
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function Header({
  isConnected,
  address,
  chain,
  theme,
  isSecureContext,
  onOpenWallet,
  onSelectChain,
  onToggleTheme,
}: Props): React.JSX.Element {
  return (
    <header className="app-header">
      <div className="app-header__brand">
        <img
          src="/arc-logo.svg"
          alt="Arc Secure Transak"
          width={38}
          height={38}
          className="app-header__logo"
        />
        <div style={{ minWidth: 0 }}>
          <h1 className="app-header__title display">Arc Secure Transak</h1>
          <p className="app-header__tagline">
            Anti-drainer · ephemeral burner · zero recipient exposure
          </p>
        </div>
      </div>

      <div className="app-header__actions">
        {/* Secure context indicator */}
        <span
          className={`badge ${isSecureContext ? 'badge--confirmed' : 'badge--failed'}`}
          title={
            isSecureContext
              ? 'Web Crypto available — burner keys are AES-256-GCM encrypted'
              : 'Insecure origin — open over HTTPS or localhost to enable encrypted keys'
          }
          style={{ gap: 4 }}
        >
          <Shield size={10} aria-hidden="true" style={{ strokeWidth: 2.5 }} />
          {isSecureContext ? 'secure' : 'insecure'}
        </span>

        {/* Chain selector */}
        {SUPPORTED_CHAINS.length > 1 && (
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <label className="sr-only" htmlFor="chain-select">
              Network
            </label>
            <select
              id="chain-select"
              className="input input--compact"
              value={chain.id}
              onChange={(event) => onSelectChain(Number(event.target.value))}
              style={{ paddingRight: 28, appearance: 'none', cursor: 'pointer' }}
            >
              {SUPPORTED_CHAINS.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
            <ChevronDown
              size={12}
              aria-hidden="true"
              style={{
                position: 'absolute',
                right: 10,
                pointerEvents: 'none',
                color: 'var(--muted)',
              }}
            />
          </div>
        )}

        {/* Theme toggle */}
        <button
          type="button"
          className="btn btn--icon-square"
          onClick={onToggleTheme}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        >
          {theme === 'dark' ? (
            <Sun size={15} aria-hidden="true" />
          ) : (
            <Moon size={15} aria-hidden="true" />
          )}
        </button>

        {/* Wallet button */}
        <button
          type="button"
          className={isConnected ? 'btn btn--ghost' : 'btn btn--accent'}
          onClick={onOpenWallet}
          style={{ gap: 6 }}
        >
          <Wallet size={13} aria-hidden="true" style={{ flexShrink: 0 }} />
          {isConnected && address !== null ? shortAddress(address) : 'Connect wallet'}
        </button>
      </div>
    </header>
  );
}

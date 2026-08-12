import { ICONS } from '../config/constants';
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
        <img src="/arc-logo.svg" alt="" width={40} height={40} className="app-header__logo" />
        <div style={{ minWidth: 0 }}>
          <h1 className="app-header__title">Arc Secure Transak</h1>
          <p className="app-header__tagline">
            Anti-drainer transfers via an ephemeral burner wallet
          </p>
        </div>
      </div>

      <div className="app-header__actions">
        {/* The secure-context state is shown, not hidden: without crypto.subtle
            the key vault cannot operate, and the user deserves to know before
            they start rather than at the moment a transfer fails. */}
        <span
          className={`badge ${isSecureContext ? 'badge--confirmed' : 'badge--failed'}`}
          title={
            isSecureContext
              ? 'Web Crypto available — burner keys can be encrypted'
              : 'Insecure origin — open over HTTPS or localhost to enable encrypted keys'
          }
        >
          {isSecureContext ? `${ICONS.shield} secure` : '⚠ insecure origin'}
        </span>

        {SUPPORTED_CHAINS.length > 1 && (
          <>
            <label className="sr-only" htmlFor="chain-select">
              Network
            </label>
            <select
              id="chain-select"
              className="input input--compact"
              value={chain.id}
              onChange={(event) => onSelectChain(Number(event.target.value))}
            >
              {SUPPORTED_CHAINS.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </>
        )}

        <button
          type="button"
          className="btn btn--icon-square"
          onClick={onToggleTheme}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        >
          {theme === 'dark' ? '☀' : '☾'}
        </button>

        <button
          type="button"
          className={isConnected ? 'btn btn--ghost' : 'btn btn--accent'}
          onClick={onOpenWallet}
        >
          {isConnected && address !== null
            ? `${ICONS.wallet} ${shortAddress(address)}`
            : 'Connect wallet'}
        </button>
      </div>
    </header>
  );
}

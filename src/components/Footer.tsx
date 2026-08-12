import { FaDiscord, FaGithub, FaTelegramPlane } from 'react-icons/fa';
import type { ChainConfig } from '../types';

interface Props {
  readonly chain: ChainConfig;
}

const LINKS = [
  { href: 'https://t.me/e0303', label: 'Telegram', Icon: FaTelegramPlane },
  { href: 'https://discord.com/users/testerevm', label: 'Discord', Icon: FaDiscord },
  { href: 'https://github.com/endijuan33', label: 'GitHub', Icon: FaGithub },
] as const;

/**
 * Footer.
 *
 * States the three facts that define the app's guarantee rather than only linking
 * out: how keys are handled, which network is live, and how many approvals a
 * transfer costs. A user who reads nothing else should still see the approval
 * count, because that is what makes an unexpected third prompt recognisable.
 */
export function Footer({ chain }: Props): React.JSX.Element {
  return (
    <footer className="app-footer">
      <div className="app-footer__facts">
        <span className="app-footer__fact">
          <strong>Keys</strong> generated in memory, AES-256-GCM encrypted, never persisted
        </span>
        <span className="app-footer__fact">
          <strong>Network</strong> {chain.name}
          {chain.testnet && ' · testnet'} · {chain.rpcEndpoints.length} RPC endpoints with failover
        </span>
        <span className="app-footer__fact">
          <strong>Approvals</strong> at most two per transfer, both to addresses this app controls
        </span>
      </div>

      <div className="app-footer__links">
        {LINKS.map(({ href, label, Icon }) => (
          <a key={label} href={href} target="_blank" rel="noopener noreferrer">
            <Icon size={14} aria-hidden="true" /> {label}
          </a>
        ))}
      </div>
    </footer>
  );
}

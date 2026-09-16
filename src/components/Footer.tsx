import { FaDiscord, FaGithub, FaTelegramPlane } from 'react-icons/fa';
import { Lock, Radio, ShieldCheck } from 'lucide-react';
import type { ChainConfig } from '../types';

interface Props {
  readonly chain: ChainConfig;
}

const LINKS = [
  { href: 'https://t.me/e0303', label: 'Telegram', Icon: FaTelegramPlane },
  { href: 'https://discord.com/users/testerevm', label: 'Discord', Icon: FaDiscord },
  { href: 'https://github.com/endijuan33', label: 'GitHub', Icon: FaGithub },
] as const;

export function Footer({ chain }: Props): React.JSX.Element {
  return (
    <footer className="app-footer">
      <div className="app-footer__facts">
        <span className="app-footer__fact">
          <strong>
            <Lock size={8} aria-hidden="true" style={{ display: 'inline', marginRight: 4 }} />
            Keys
          </strong>
          Generated in memory, AES-256-GCM encrypted, never persisted to disk or storage
        </span>
        <span className="app-footer__fact">
          <strong>
            <Radio size={8} aria-hidden="true" style={{ display: 'inline', marginRight: 4 }} />
            Network
          </strong>
          {chain.name}
          {chain.testnet && ' · testnet'} · {chain.rpcEndpoints.length} RPC endpoints with failover
        </span>
        <span className="app-footer__fact">
          <strong>
            <ShieldCheck size={8} aria-hidden="true" style={{ display: 'inline', marginRight: 4 }} />
            Approvals
          </strong>
          At most two per transfer, both to addresses this app controls — never to the recipient
        </span>
      </div>

      <div className="app-footer__links">
        {LINKS.map(({ href, label, Icon }) => (
          <a key={label} href={href} target="_blank" rel="noopener noreferrer">
            <Icon size={13} aria-hidden="true" /> {label}
          </a>
        ))}
      </div>
    </footer>
  );
}

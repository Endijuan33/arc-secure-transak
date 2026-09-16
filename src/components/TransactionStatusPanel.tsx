import { CheckCircle, XCircle, AlertTriangle, Info, Loader2, type LucideIcon } from 'lucide-react';
import type { TransactionStatus } from '../types';

interface Props {
  readonly status: TransactionStatus | 'idle';
  readonly message: string;
  readonly isRunning: boolean;
}

const PRESENTATION: Record<
  TransactionStatus | 'idle',
  {
    readonly variant: string;
    readonly Icon: LucideIcon;
    readonly title: string;
  }
> = {
  idle: { variant: 'info', Icon: Info, title: 'Ready' },
  pending: { variant: 'info', Icon: Loader2, title: 'In progress' },
  confirmed: { variant: 'success', Icon: CheckCircle, title: 'Confirmed' },
  failed: { variant: 'error', Icon: XCircle, title: 'Failed' },
  aborted: { variant: 'warning', Icon: AlertTriangle, title: 'Aborted' },
};

export function TransactionStatusPanel({ status, message, isRunning }: Props): React.JSX.Element {
  const { variant, Icon, title } = PRESENTATION[status];

  return (
    <div className={`callout callout--${variant}`} aria-live="polite">
      <span className="callout__icon">
        {isRunning ? (
          <Loader2 size={16} aria-hidden="true" className="spinner" />
        ) : (
          <Icon size={16} aria-hidden="true" />
        )}
      </span>
      <div style={{ minWidth: 0 }}>
        <strong style={{ display: 'block', marginBottom: 2 }}>{title}</strong>
        <span style={{ wordBreak: 'break-word', lineHeight: 1.55, fontSize: 13 }}>{message}</span>
      </div>
    </div>
  );
}

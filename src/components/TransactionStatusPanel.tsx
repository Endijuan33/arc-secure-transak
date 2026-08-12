import { ICONS } from '../config/constants';
import type { TransactionStatus } from '../types';

interface Props {
  readonly status: TransactionStatus | 'idle';
  readonly message: string;
  readonly isRunning: boolean;
}

const PRESENTATION: Record<
  TransactionStatus | 'idle',
  { readonly variant: string; readonly icon: string; readonly title: string }
> = {
  idle: { variant: 'info', icon: ICONS.info, title: 'Ready' },
  pending: { variant: 'info', icon: ICONS.loading, title: 'In progress' },
  confirmed: { variant: 'success', icon: ICONS.check, title: 'Confirmed' },
  failed: { variant: 'error', icon: ICONS.error, title: 'Failed' },
  aborted: { variant: 'warning', icon: ICONS.abort, title: 'Aborted' },
};

/**
 * Single-line status banner.
 *
 * Narrowed to exactly that: the technical log moved to `ActivityLog` and the
 * transaction details to `TransactionReceipt`. Previously this component carried
 * all three, which meant the one thing a user checks at a glance — what is
 * happening right now — competed with a wall of debug text.
 */
export function TransactionStatusPanel({ status, message, isRunning }: Props): React.JSX.Element {
  const presentation = PRESENTATION[status];

  return (
    <div className={`callout callout--${presentation.variant}`} aria-live="polite">
      <span className="callout__icon">
        {isRunning ? <span className="spinner">{ICONS.loading}</span> : presentation.icon}
      </span>
      <div style={{ minWidth: 0 }}>
        <strong style={{ display: 'block', marginBottom: 2 }}>{presentation.title}</strong>
        <span style={{ wordBreak: 'break-word', lineHeight: 1.5 }}>{message}</span>
      </div>
    </div>
  );
}

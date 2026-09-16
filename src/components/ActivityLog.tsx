import { useMemo, useState } from 'react';
import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  Info,
  Copy,
  Check,
  Loader2,
  type LucideIcon,
} from 'lucide-react';
import type { ActivityLogEntry, NotificationLevel } from '../types';

interface Props {
  readonly entries: readonly ActivityLogEntry[];
  readonly isRunning: boolean;
}

type Filter = 'all' | 'milestones' | 'problems';

const LEVEL_ICON: Record<NotificationLevel, LucideIcon> = {
  success: CheckCircle,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

function formatElapsed(ms: number): string {
  if (ms < 1000) return `+0.${Math.floor(ms / 100)}s`;
  const seconds = ms / 1000;
  return seconds < 10 ? `+${seconds.toFixed(1)}s` : `+${Math.round(seconds)}s`;
}

function formatClock(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function ActivityLog({ entries, isRunning }: Props): React.JSX.Element | null {
  const [filter, setFilter] = useState<Filter>('milestones');
  const [copied, setCopied] = useState(false);

  const visible = useMemo(() => {
    switch (filter) {
      case 'all':
        return entries;
      case 'milestones':
        return entries.filter(
          (entry) =>
            entry.phase === 'done' || entry.phase === 'skipped' || entry.phase === 'failed',
        );
      case 'problems':
        return entries.filter((entry) => entry.level === 'error' || entry.level === 'warning');
    }
  }, [entries, filter]);

  const problemCount = useMemo(
    () => entries.filter((entry) => entry.level === 'error' || entry.level === 'warning').length,
    [entries],
  );

  if (entries.length === 0) return null;

  const asPlainText = (): string =>
    entries
      .map(
        (entry) =>
          `${formatClock(entry.at)}  ${formatElapsed(entry.elapsedMs).padStart(7)}  ` +
          `${entry.stepLabel} — ${entry.message}`,
      )
      .join('\n');

  return (
    <section className="panel stack" style={{ gap: 'var(--space-3)' }} aria-label="Activity log">
      <div className="row-between" style={{ flexWrap: 'wrap', rowGap: 'var(--space-2)' }}>
        <span className="row" style={{ gap: 'var(--space-2)' }}>
          <span className="label" style={{ marginBottom: 0 }}>
            Activity
          </span>
          {isRunning && (
            <span className="badge badge--pending" style={{ gap: 4 }}>
              <Loader2 size={9} aria-hidden="true" className="spinner" />
              live
            </span>
          )}
          {!isRunning && problemCount > 0 && (
            <span className="badge badge--failed">
              {problemCount} {problemCount === 1 ? 'issue' : 'issues'}
            </span>
          )}
        </span>

        <div className="row" style={{ gap: 'var(--space-2)' }}>
          <div className="segmented" role="group" aria-label="Log detail level">
            {(
              [
                ['milestones', 'Milestones'],
                ['all', 'Detailed'],
                ['problems', 'Issues'],
              ] as const
            ).map(([value, text]) => (
              <button
                key={value}
                type="button"
                className={`segmented__option${filter === value ? ' segmented__option--active' : ''}`}
                onClick={() => setFilter(value)}
                aria-pressed={filter === value}
              >
                {text}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn btn--chip"
            onClick={() => {
              void navigator.clipboard
                .writeText(asPlainText())
                .then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                })
                .catch(() => setCopied(false));
            }}
            style={{ gap: 4 }}
          >
            {copied ? (
              <>
                <Check size={10} aria-hidden="true" /> Copied
              </>
            ) : (
              <>
                <Copy size={10} aria-hidden="true" /> Copy
              </>
            )}
          </button>
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="hint" style={{ margin: 0 }}>
          {filter === 'problems' ? 'No issues recorded.' : 'Nothing to show at this level.'}
        </p>
      ) : (
        <ol className="log" aria-live={isRunning ? 'polite' : 'off'}>
          {visible.map((entry) => {
            const Icon = LEVEL_ICON[entry.level];
            return (
              <li key={entry.id} className={`log__row log__row--${entry.level}`}>
                <span className="log__time" title={formatClock(entry.at)}>
                  {formatElapsed(entry.elapsedMs)}
                </span>
                <span className="log__glyph" aria-hidden="true">
                  <Icon size={11} aria-hidden="true" />
                </span>
                <span className="log__body">
                  <span className="log__step">{entry.stepLabel}</span>
                  <span className="log__message">{entry.message}</span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

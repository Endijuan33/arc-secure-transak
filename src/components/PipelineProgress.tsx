import { Check, X, Minus, Loader2, PenLine } from 'lucide-react';
import type { ChainConfig, PipelineStep } from '../types';
import { pipelineProgress, stepDefinition } from '../store/pipeline';

interface Props {
  readonly steps: readonly PipelineStep[];
  readonly isRunning: boolean;
  readonly chain: ChainConfig;
}

function MarkerContent({ step }: { readonly step: PipelineStep }): React.JSX.Element {
  switch (step.state) {
    case 'done':
      return <Check size={12} aria-hidden="true" strokeWidth={3} />;
    case 'failed':
      return <X size={12} aria-hidden="true" strokeWidth={3} />;
    case 'skipped':
      return <Minus size={12} aria-hidden="true" strokeWidth={2.5} />;
    case 'active':
      return <Loader2 size={12} aria-hidden="true" className="spinner" />;
    case 'idle':
      return <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>{step.index}</span>;
  }
}

function duration(step: PipelineStep): string | null {
  if (step.startedAt === null || step.finishedAt === null) return null;
  const ms = step.finishedAt - step.startedAt;
  if (ms < 100) return null;
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function PipelineProgress({ steps, isRunning, chain }: Props): React.JSX.Element {
  const hasActivity = steps.some((step) => step.state !== 'idle');
  const progress = Math.round(pipelineProgress(steps) * 100);
  const active = steps.find((step) => step.state === 'active') ?? null;

  return (
    <section
      className="stack"
      style={{ gap: 'var(--space-3)' }}
      aria-label="Secure pipeline"
      aria-busy={isRunning}
    >
      <div className="row-between" style={{ flexWrap: 'wrap', rowGap: 'var(--space-1)' }}>
        <span className="label" style={{ marginBottom: 0 }}>
          Secure pipeline
        </span>
        <span className="hint">
          {hasActivity ? (
            <>
              {progress}% — {active !== null ? active.label : 'settled'}
            </>
          ) : (
            <>10 stages &middot; 2 wallet approvals</>
          )}
        </span>
      </div>

      {hasActivity && (
        <div
          className="progress-track"
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Pipeline ${progress}% complete`}
        >
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
      )}

      <ol className="timeline">
        {steps.map((step) => {
          const definition = stepDefinition(step.id);
          const elapsed = duration(step);
          return (
            <li key={step.id} className={`timeline__item timeline__item--${step.state}`}>
              <span className="timeline__marker" aria-hidden="true">
                <MarkerContent step={step} />
              </span>

              <div className="timeline__body">
                <div className="timeline__head">
                  <span className="timeline__label">{step.label}</span>
                  {definition.signature && (
                    <span
                      className="tag tag--signature"
                      title="Requires a wallet approval"
                      style={{ gap: 3 }}
                    >
                      <PenLine size={8} aria-hidden="true" />
                      signature
                    </span>
                  )}
                  {elapsed !== null && <span className="timeline__duration">{elapsed}</span>}
                </div>
                <p className="timeline__detail">{step.detail ?? definition.summary}</p>
              </div>
            </li>
          );
        })}
      </ol>

      {!hasActivity && (
        <p className="hint" style={{ margin: 0 }}>
          Assets are routed through a single-use burner on {chain.name}. Your wallet never signs a
          transaction addressed to the recipient.
        </p>
      )}
    </section>
  );
}

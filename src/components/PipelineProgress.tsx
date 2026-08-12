import type { ChainConfig, PipelineStep } from '../types';
import { pipelineProgress, stepDefinition } from '../store/pipeline';

interface Props {
  readonly steps: readonly PipelineStep[];
  readonly isRunning: boolean;
  readonly chain: ChainConfig;
}

function markerFor(step: PipelineStep): string {
  switch (step.state) {
    case 'done':
      return '✓';
    case 'failed':
      return '✕';
    case 'skipped':
      return '–';
    case 'active':
    case 'idle':
      return String(step.index);
  }
}

/** Wall-clock duration of a settled step, once it is worth showing. */
function duration(step: PipelineStep): string | null {
  if (step.startedAt === null || step.finishedAt === null) return null;
  const ms = step.finishedAt - step.startedAt;
  if (ms < 100) return null;
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/**
 * The ten-stage pipeline, shown as a vertical timeline.
 *
 * Two things the previous version did not convey: how long each stage took, and
 * which stages require a wallet approval. The second matters for security — a
 * user who knows exactly two approvals are expected can recognise a third as an
 * anomaly rather than a normal prompt.
 *
 * Before a run starts this renders the pipeline as a preview, so the process is
 * legible before any funds move rather than only while they are moving.
 */
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
              {progress}% · {active !== null ? active.label : 'settled'}
            </>
          ) : (
            <>10 stages · 2 wallet approvals</>
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
                {step.state === 'active' ? <span className="spinner">⟳</span> : markerFor(step)}
              </span>

              <div className="timeline__body">
                <div className="timeline__head">
                  <span className="timeline__label">{step.label}</span>
                  {definition.signature && (
                    <span className="tag tag--signature" title="Requires a wallet approval">
                      signature
                    </span>
                  )}
                  {elapsed !== null && <span className="timeline__duration">{elapsed}</span>}
                </div>

                {/* Live detail while running; the static explanation otherwise, so
                    the panel is informative before a transfer has been started. */}
                <p className="timeline__detail">
                  {step.detail ?? definition.summary}
                </p>
              </div>
            </li>
          );
        })}
      </ol>

      {!hasActivity && (
        <p className="hint" style={{ margin: 0 }}>
          Assets are routed through a single-use burner on {chain.name}, so your wallet never signs
          a transaction addressed to the recipient.
        </p>
      )}
    </section>
  );
}

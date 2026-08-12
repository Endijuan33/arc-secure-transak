/**
 * Root error boundary.
 *
 * Catches render-phase and lifecycle exceptions anywhere below it and shows a
 * recoverable screen instead of a blank page. `resetKey` lets the user retry
 * without a full reload: remounting the subtree is enough for a transient
 * failure, and a reload is offered as the fallback.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  readonly children: ReactNode;
  /** Rendered instead of the default screen when provided. */
  readonly fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  readonly error: Error | null;
  readonly resetKey: number;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, resetKey: 0 };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    // Kept to `console.error` deliberately: no remote reporting, because a stack
    // trace from this app can contain wallet addresses and transfer amounts.
    console.error('Unhandled application error:', error, info.componentStack);
  }

  private readonly reset = (): void => {
    this.setState((previous) => ({ error: null, resetKey: previous.resetKey + 1 }));
  };

  override render(): ReactNode {
    const { error, resetKey } = this.state;
    if (error === null) {
      return <div key={resetKey}>{this.props.children}</div>;
    }
    if (this.props.fallback !== undefined) {
      return this.props.fallback(error, this.reset);
    }

    return (
      <div className="app-shell" role="alert">
        <div className="app-card stack">
          <h2 style={{ margin: 0, color: 'var(--danger-text)' }}>Something broke</h2>
          <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
            The interface hit an unexpected error. No transaction was sent as a result of this
            failure, and no key material is written to disk.
          </p>
          <pre
            className="mono"
            style={{
              margin: 0,
              padding: 'var(--space-4)',
              background: 'var(--bg-surface-sunken)',
              borderRadius: 'var(--radius-md)',
              fontSize: 12,
              maxHeight: 200,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
            }}
          >
            {error.message}
          </pre>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn--ghost" onClick={this.reset}>
              Try again
            </button>
            <button
              type="button"
              className="btn btn--accent"
              onClick={() => window.location.reload()}
            >
              Reload app
            </button>
          </div>
        </div>
      </div>
    );
  }
}

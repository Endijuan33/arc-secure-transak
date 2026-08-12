import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { initAppKit } from './config/appkit';
import './index.css';

/** Rethrows during render so the boundary above can catch a bootstrap failure. */
function ThrowOnRender({ error }: { readonly error: unknown }): never {
  throw error instanceof Error ? error : new Error(String(error));
}

/**
 * Entry point.
 *
 * AppKit is initialised before the first render because its React hooks read
 * from a controller that must already exist. A failure here (a missing project
 * ID, for instance) is surfaced through the error boundary rather than as a
 * blank page.
 */
function bootstrap(): void {
  const container = document.getElementById('root');
  if (container === null) {
    throw new Error('Root element #root is missing from index.html.');
  }

  const root = createRoot(container);

  try {
    initAppKit();
  } catch (error: unknown) {
    root.render(
      <ErrorBoundary
        fallback={(caught) => (
          <div className="app-shell">
            <div className="app-card stack">
              <h2 style={{ margin: 0, color: 'var(--danger-text)' }}>Configuration required</h2>
              <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{caught.message}</p>
              <p className="hint" style={{ margin: 0 }}>
                Copy <code>.env.example</code> to <code>.env</code>, set
                <code> VITE_REOWN_PROJECT_ID</code>, then restart the dev server.
              </p>
            </div>
          </div>
        )}
      >
        <ThrowOnRender error={error} />
      </ErrorBoundary>,
    );
    return;
  }

  // Theme is applied before paint so there is no flash of the wrong palette
  // while React mounts.
  try {
    const stored = localStorage.getItem('arc.theme.v1');
    const theme =
      stored === 'light' || stored === 'dark'
        ? stored
        : window.matchMedia('(prefers-color-scheme: light)').matches
          ? 'light'
          : 'dark';
    document.documentElement.setAttribute('data-theme', theme);
  } catch {
    document.documentElement.setAttribute('data-theme', 'dark');
  }

  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

bootstrap();

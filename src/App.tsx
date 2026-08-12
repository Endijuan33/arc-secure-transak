import { ErrorBoundary } from './components/ErrorBoundary';
import { NotificationCenter } from './components/NotificationCenter';
import { TransferPage } from './pages/TransferPage';

/**
 * Composition root.
 *
 * All feature logic lives in `TransferPage`, hooks, and services; this file only
 * wires the error boundary and the notification bridge around it.
 */
export default function App(): React.JSX.Element {
  return (
    <ErrorBoundary>
      <NotificationCenter />
      <TransferPage />
    </ErrorBoundary>
  );
}

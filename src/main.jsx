// src/main.jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

// Absolute Robustness: Global Error Boundary at the highest level
class GlobalErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Critical Application Error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          background: '#0f172a',
          color: '#f1f5f9',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          padding: '20px',
          fontFamily: 'monospace'
        }}>
          <h2 style={{ color: '#ef4444' }}>⚠️ System Failure Detected</h2>
          <pre style={{ background: '#1e293b', padding: '16px', borderRadius: '8px', maxWidth: '100%', overflow: 'auto' }}>
            {this.state.error?.message || 'Unknown fatal error occurred in the React tree.'}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{ marginTop: '16px', padding: '10px 24px', background: '#3b82f6', border: 'none', borderRadius: '8px', color: '#fff', cursor: 'pointer', fontWeight: 'bold' }}
          >
            Reboot Application
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <GlobalErrorBoundary>
      <App />
    </GlobalErrorBoundary>
  </React.StrictMode>,
);

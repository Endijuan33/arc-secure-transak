// src/components/AccountInfo.jsx
import React from 'react';
import { safeFormat } from '../utils/helpers';

export default function AccountInfo({ isConnected, networkName, balance }) {
  if (!isConnected) return null;
  
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      backgroundColor: 'rgba(255,255,255,0.04)',
      borderRadius: '16px',
      padding: '12px 16px',
      marginBottom: '24px',
      border: '1px solid rgba(255,255,255,0.05)'
    }}>
      <div style={{ color: '#cbd5e1', fontSize: '13px' }}>
        <span style={{ opacity: 0.6 }}>Network:</span>{' '}
        <strong style={{ color: '#e2e8f0' }}>{networkName || 'Arc Testnet'}</strong>
      </div>
      {balance !== null && (
        <div style={{ color: '#cbd5e1', fontSize: '13px' }}>
          <span style={{ opacity: 0.6 }}>Native Balance:</span>{' '}
          <strong style={{ color: '#e2e8f0' }}>{safeFormat(balance)} USDC</strong>
        </div>
      )}
    </div>
  );
}

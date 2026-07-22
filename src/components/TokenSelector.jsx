// src/components/TokenSelector.jsx
import React from 'react';
import { safeFormat } from '../utils/helpers';

export default function TokenSelector({ isConnected, tokenBalances, selectedToken, setSelectedToken }) {
  if (!isConnected || tokenBalances.length === 0) return null;

  return (
    <div>
      <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#e2e8f0', marginBottom: '8px' }}>
        Select Token to Send
      </label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        {tokenBalances.map((token) => {
          const isSelected = selectedToken &&
            ((token.isNative && selectedToken.isNative) ||
             (token.address === selectedToken.address));
          const balanceNum = token.balance > 0n ? safeFormat(token.balanceFormatted) : '0';
          return (
            <button
              key={token.address || 'native'}
              type="button"
              onClick={() => setSelectedToken(token)}
              style={{
                padding: '8px 14px',
                background: isSelected ? 'rgba(139,92,246,0.3)' : 'rgba(255,255,255,0.06)',
                border: isSelected ? '1px solid #8b5cf6' : '1px solid rgba(255,255,255,0.1)',
                borderRadius: '40px',
                color: '#e2e8f0',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: isSelected ? '600' : '400',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'all 0.2s'
              }}
            >
              {token.logo && <img src={token.logo} alt={token.symbol} style={{ width: '18px', height: '18px', borderRadius: '50%' }} />}
              <span>{token.symbol}</span>
              <span style={{ fontSize: '11px', opacity: 0.6 }}>({balanceNum})</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

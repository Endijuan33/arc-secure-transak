// src/components/Header.jsx
import React from 'react';
import { ICONS } from '../config/constants';

export default function Header({ isConnected, address, open }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '24px',
      borderBottom: '1px solid rgba(255,255,255,0.06)',
      paddingBottom: '16px'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <img
          src="/arc-logo.svg"
          alt="Arc Secure Transak"
          style={{ height: '42px', width: 'auto' }}
        />
        <div>
          <h1 style={{
            margin: 0,
            fontSize: '24px',
            fontWeight: '700',
            background: 'linear-gradient(135deg, #60a5fa, #a78bfa)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            display: 'inline-block'
          }}>
            Arc Secure Transak
          </h1>
          <p style={{
            margin: '4px 0 0 0',
            fontSize: '13px',
            color: '#94a3b8',
            letterSpacing: '0.3px'
          }}>
            🔒 Anti-Drainer Native & ERC-20 Transfer
          </p>
        </div>
      </div>
      <button
        onClick={() => open()}
        style={{
          padding: '10px 18px',
          background: isConnected ? 'rgba(255,255,255,0.08)' : 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
          color: isConnected ? '#e2e8f0' : '#ffffff',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '40px',
          cursor: 'pointer',
          fontWeight: '600',
          fontSize: '13px',
          transition: 'all 0.2s',
          backdropFilter: 'blur(4px)',
          boxShadow: isConnected ? 'none' : '0 4px 12px rgba(59,130,246,0.4)'
        }}
        onMouseEnter={(e) => { if (!isConnected) e.target.style.transform = 'scale(1.03)'; }}
        onMouseLeave={(e) => { if (!isConnected) e.target.style.transform = 'scale(1)'; }}
      >
        {isConnected && address
          ? `${ICONS.wallet} ${address.slice(0, 4)}...${address.slice(-4)}`
          : 'Connect Wallet'
        }
      </button>
    </div>
  );
}

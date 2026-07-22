// src/components/Footer.jsx
import React from 'react';
import { FaTelegramPlane, FaDiscord, FaGithub } from 'react-icons/fa';

export default function Footer() {
  return (
    <div style={{
      marginTop: '24px',
      borderTop: '1px solid rgba(255,255,255,0.05)',
      paddingTop: '16px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '16px'
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
        <span style={{
          color: 'rgba(255,255,255,0.6)',
          fontSize: '12px',
          fontWeight: '500',
          letterSpacing: '0.5px'
        }}>
          Interact with me
        </span>

        <div style={{ display: 'flex', gap: '18px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <a
            href="https://t.me/e0303"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: 'rgba(255,255,255,0.4)',
              textDecoration: 'none',
              fontSize: '13px',
              transition: 'color 0.2s',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
            onMouseEnter={(e) => e.currentTarget.style.color = '#26a5e4'}
            onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(255,255,255,0.4)'}
          >
            <FaTelegramPlane size={15} /> Telegram
          </a>
          <a
            href="https://discord.com/users/testerevm"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: 'rgba(255,255,255,0.4)',
              textDecoration: 'none',
              fontSize: '13px',
              transition: 'color 0.2s',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
            onMouseEnter={(e) => e.currentTarget.style.color = '#5865F2'}
            onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(255,255,255,0.4)'}
          >
            <FaDiscord size={15} /> Discord
          </a>
          <a
            href="https://github.com/endijuan33"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: 'rgba(255,255,255,0.4)',
              textDecoration: 'none',
              fontSize: '13px',
              transition: 'color 0.2s',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
            onMouseEnter={(e) => e.currentTarget.style.color = '#f0f6fc'}
            onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(255,255,255,0.4)'}
          >
            <FaGithub size={15} /> GitHub
          </a>
        </div>
      </div>

      <div style={{
        color: 'rgba(255,255,255,0.15)',
        fontSize: '10px',
        textAlign: 'center'
      }}>
        Powered by Arc Community · Arc Secure Transak (Arc Testnet)
      </div>
    </div>
  );
}

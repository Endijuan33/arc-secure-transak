// src/components/DestinationInput.jsx
import React, { useRef, useState } from 'react';
import { ICONS } from '../config/constants';
import { isAddress } from '../utils/helpers';

export default function DestinationInput({
  recipient,
  setRecipient,
  addressBook,
  showBookmarks,
  setShowBookmarks,
  newAddress,
  setNewAddress,
  newTag,
  setNewTag,
  handleAddAddress,
  handleDeleteAddress,
  handleSelectAddress,
  copyToClipboard,
}) {
  const [showDropdown, setShowDropdown] = useState(false);
  const addressInputRef = useRef(null);

  const handleFocus = () => {
    if (addressBook.length > 0) setShowDropdown(true);
    if (addressInputRef.current) {
      addressInputRef.current.style.borderColor = '#8b5cf6';
    }
  };

  const handleBlur = () => {
    setTimeout(() => setShowDropdown(false), 200);
    if (addressInputRef.current) {
      addressInputRef.current.style.borderColor = 'rgba(255,255,255,0.1)';
    }
  };

  return (
    <div>
      <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px', fontWeight: '600', color: '#e2e8f0', marginBottom: '8px' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span>{ICONS.address}</span> Destination Address
        </span>
        <button
          type="button"
          onClick={() => setShowBookmarks(!showBookmarks)}
          style={{
            background: 'rgba(139,92,246,0.15)',
            border: '1px solid rgba(139,92,246,0.3)',
            borderRadius: '20px',
            padding: '2px 12px',
            fontSize: '11px',
            fontWeight: '600',
            color: '#a78bfa',
            cursor: 'pointer',
            transition: 'all 0.2s',
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}
          onMouseEnter={(e) => e.target.style.background = 'rgba(139,92,246,0.25)'}
          onMouseLeave={(e) => e.target.style.background = 'rgba(139,92,246,0.15)'}
        >
          {ICONS.addressBook} Bookmarks
        </button>
      </label>

      <div style={{ position: 'relative' }}>
        <input
          ref={addressInputRef}
          type="text"
          placeholder="0x... or select from bookmarks"
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          onFocus={handleFocus}
          onBlur={handleBlur}
          style={{
            width: '100%',
            padding: '14px 16px',
            borderRadius: '16px',
            border: '1px solid rgba(255,255,255,0.1)',
            background: 'rgba(255,255,255,0.05)',
            fontSize: '14px',
            color: '#f1f5f9',
            outline: 'none',
            fontFamily: 'monospace'
          }}
          required
        />
        {recipient && isAddress(recipient) && (
          <button
            type="button"
            onClick={() => copyToClipboard(recipient)}
            style={{
              position: 'absolute',
              right: '12px',
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              fontSize: '18px'
            }}
          >
            {ICONS.copy}
          </button>
        )}
      </div>

      {/* Dropdown for address book */}
      {showDropdown && addressBook.length > 0 && (
        <div style={{
          marginTop: '8px',
          background: 'rgba(30,41,59,0.95)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '12px',
          padding: '8px 0',
          maxHeight: '150px',
          overflowY: 'auto',
          backdropFilter: 'blur(10px)',
          zIndex: 10
        }}>
          {addressBook.map(entry => (
            <div
              key={entry.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '8px 16px',
                cursor: 'pointer',
                borderBottom: '1px solid rgba(255,255,255,0.05)',
                transition: 'background 0.15s'
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              onClick={() => handleSelectAddress(entry.address)}
            >
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <div style={{ color: '#e2e8f0', fontSize: '13px', fontWeight: '500' }}>
                  {entry.tag}
                </div>
                <div style={{ color: '#94a3b8', fontSize: '11px', fontFamily: 'monospace' }}>
                  {entry.address.slice(0, 6)}...{entry.address.slice(-4)}
                </div>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteAddress(entry.id);
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  fontSize: '14px',
                  padding: '4px 8px',
                  borderRadius: '6px',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={(e) => { e.target.style.color = '#f87171'; e.target.style.background = 'rgba(239,68,68,0.1)'; }}
                onMouseLeave={(e) => { e.target.style.color = '#94a3b8'; e.target.style.background = 'transparent'; }}
              >
                {ICONS.delete}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Bookmarks Panel */}
      {showBookmarks && (
        <div style={{
          marginTop: '12px',
          padding: '16px',
          background: 'rgba(30,41,59,0.9)',
          border: '1px solid rgba(139,92,246,0.2)',
          borderRadius: '12px',
          backdropFilter: 'blur(10px)'
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* Address List */}
            {addressBook.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '150px', overflowY: 'auto' }}>
                {addressBook.map(entry => (
                  <div
                    key={entry.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      background: 'rgba(255,255,255,0.03)',
                      cursor: 'pointer',
                      transition: 'background 0.15s',
                      borderBottom: '1px solid rgba(255,255,255,0.05)'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                    onClick={() => handleSelectAddress(entry.address)}
                  >
                    <div>
                      <div style={{ color: '#e2e8f0', fontSize: '13px', fontWeight: '500' }}>
                        {entry.tag}
                      </div>
                      <div style={{ color: '#94a3b8', fontSize: '11px', fontFamily: 'monospace' }}>
                        {entry.address.slice(0, 6)}...{entry.address.slice(-4)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteAddress(entry.id);
                      }}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#94a3b8',
                        cursor: 'pointer',
                        fontSize: '14px',
                        padding: '4px 8px',
                        borderRadius: '6px',
                        transition: 'all 0.2s'
                      }}
                      onMouseEnter={(e) => { e.target.style.color = '#f87171'; e.target.style.background = 'rgba(239,68,68,0.1)'; }}
                      onMouseLeave={(e) => { e.target.style.color = '#94a3b8'; e.target.style.background = 'transparent'; }}
                    >
                      {ICONS.delete}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ color: '#64748b', fontSize: '13px', textAlign: 'center', padding: '8px 0' }}>
                No bookmarks yet
              </div>
            )}

            <hr style={{ borderColor: 'rgba(255,255,255,0.06)' }} />

            {/* Add Address Form */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <input
                type="text"
                placeholder="Address (0x...)"
                value={newAddress}
                onChange={(e) => setNewAddress(e.target.value)}
                style={{
                  padding: '10px 14px',
                  borderRadius: '10px',
                  border: '1px solid rgba(255,255,255,0.1)',
                  background: 'rgba(255,255,255,0.05)',
                  fontSize: '13px',
                  color: '#f1f5f9',
                  outline: 'none',
                  fontFamily: 'monospace'
                }}
                onFocus={(e) => e.target.style.borderColor = '#8b5cf6'}
                onBlur={(e) => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
              />
              <input
                type="text"
                placeholder="Tag / Name (e.g. 'Alice')"
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                style={{
                  padding: '10px 14px',
                  borderRadius: '10px',
                  border: '1px solid rgba(255,255,255,0.1)',
                  background: 'rgba(255,255,255,0.05)',
                  fontSize: '13px',
                  color: '#f1f5f9',
                  outline: 'none'
                }}
                onFocus={(e) => e.target.style.borderColor = '#8b5cf6'}
                onBlur={(e) => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
              />
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => {
                    setNewAddress('');
                    setNewTag('');
                  }}
                  style={{
                    padding: '6px 16px',
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '20px',
                    color: '#94a3b8',
                    cursor: 'pointer',
                    fontSize: '12px',
                    transition: 'all 0.2s'
                  }}
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={handleAddAddress}
                  style={{
                    padding: '6px 16px',
                    background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
                    border: 'none',
                    borderRadius: '20px',
                    color: '#fff',
                    cursor: 'pointer',
                    fontSize: '12px',
                    fontWeight: '600',
                    transition: 'all 0.2s'
                  }}
                >
                  {ICONS.add} Add
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

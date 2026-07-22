// src/App.jsx
import React, { useState, useEffect } from 'react';
import { useMediaQuery } from 'react-responsive';
import { ethers } from 'ethers';
import { useAppKit, useAppKitAccount, useAppKitProvider } from '@reown/appkit/react';
import toast, { Toaster } from 'react-hot-toast';
import { executeAbsoluteSecureTransak } from './utils/secureTransak';
import { ICONS, ITEMS_PER_PAGE, SAFETY_BUFFER, MIN_BALANCE_FOR_GAS } from './config/constants';
// FIX: Added missing loadAddressBook and saveAddressBook to prevent WSOD
import { formatTime, loadTransactions, saveTransactions, isAddress, loadAddressBook, saveAddressBook } from './utils/helpers';
import { useBalances } from './hooks/useBalances';
import Header from './components/Header';
import AccountInfo from './components/AccountInfo';
import TokenSelector from './components/TokenSelector';
import DestinationInput from './components/DestinationInput';
import Footer from './components/Footer';
import './config/reown';

export default function App() {
  const { open } = useAppKit();
  const { address, isConnected } = useAppKitAccount();
  const { walletProvider } = useAppKitProvider('eip155');
  const isDesktop = useMediaQuery({ minWidth: 768 });

  const { tokenBalances, balance, networkName } = useBalances(address, isConnected);
  const [recipient, setRecipient] = useState('');
  const [selectedToken, setSelectedToken] = useState(null);
  const [tokenAmounts, setTokenAmounts] = useState({});
  const [status, setStatus] = useState('Please connect your wallet to start.');
  const [statusType, setStatusType] = useState('info');
  const [loading, setLoading] = useState(false);
  const [txHash, setTxHash] = useState('');
  const [debugInfo, setDebugInfo] = useState('');
  const [transactions, setTransactions] = useState([]);
  const [expandedTx, setExpandedTx] = useState(null);
  const [abortController, setAbortController] = useState(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [addressBook, setAddressBook] = useState([]);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [newAddress, setNewAddress] = useState('');
  const [newTag, setNewTag] = useState('');

  // Robust initialization
  useEffect(() => {
    try {
      setTransactions(loadTransactions() || []);
      setAddressBook(loadAddressBook() || []);
    } catch (err) {
      console.error("Failed to load local data", err);
    }
  }, []);

  useEffect(() => {
    setHistoryPage(1);
  }, [transactions.length]);

  useEffect(() => {
    if (tokenBalances.length > 0 && !selectedToken) {
      const firstPositive = tokenBalances.find(t => t.balance > 0n);
      setSelectedToken(firstPositive || tokenBalances[0]);
    }
  }, [tokenBalances]);

  useEffect(() => {
    if (isConnected) {
      setStatus("Wallet connected. Select a token and enter destination address.");
      setStatusType('success');
    } else {
      setStatus("Please connect your wallet to start.");
      setStatusType('info');
      // Reset sensitive states on disconnect
      setSelectedToken(null);
      setTokenAmounts({});
    }
  }, [isConnected]);

  const saveTransaction = (hash, tokenSymbol, amountSent, recipientAddr) => {
    try {
      const newTx = {
        hash,
        token: tokenSymbol || 'Native',
        amount: amountSent,
        recipient: recipientAddr,
        timestamp: Date.now(),
        status: 'success'
      };
      const updated = [newTx, ...transactions];
      setTransactions(updated);
      saveTransactions(updated);
    } catch (e) {
      console.error('Failed to save transaction history:', e);
    }
  };

  const handleMaxAmount = () => {
    if (!selectedToken) return;
    const balanceStr = selectedToken.balanceFormatted;
    if (!balanceStr || parseFloat(balanceStr) <= 0) {
      toast.error('No balance to fill');
      return;
    }
    
    let amount = balanceStr;
    if (selectedToken.isNative) {
      const balNum = parseFloat(balanceStr);
      if (balNum > MIN_BALANCE_FOR_GAS) {
        amount = (balNum - SAFETY_BUFFER).toFixed(8);
      } else {
        toast.error('Balance too low to cover gas');
        return;
      }
    }
    
    setTokenAmounts(prev => ({
      ...prev,
      [selectedToken.address || 'native']: amount
    }));
    toast.success(`Max amount set: ${amount} ${selectedToken.symbol}`);
  };

  const handleSecureSend = async (e) => {
    e.preventDefault();
    if (!isConnected || !walletProvider) {
      toast.error('Please connect your wallet first!');
      return;
    }
    if (!isAddress(recipient)) {
      toast.error('Invalid destination address!');
      return;
    }
    if (!selectedToken) {
      toast.error('Please select a token to send.');
      return;
    }
    let amountStr = tokenAmounts[selectedToken.address || 'native'] || '';
    amountStr = amountStr.replace(/,/g, ''); 
    if (!amountStr || !/^\d+(\.\d+)?$/.test(amountStr) || parseFloat(amountStr) <= 0) {
      toast.error('Please enter a valid numeric amount.');
      return;
    }
    setLoading(true);
    setTxHash('');
    setStatusType('loading');
    setDebugInfo('');

    const controller = new AbortController();
    setAbortController(controller);

    try {
      const provider = new ethers.BrowserProvider(walletProvider);
      const signer = await provider.getSigner();

      const isNative = selectedToken.isNative || false;
      const tokenAddress = isNative ? null : selectedToken.address;
      const decimals = selectedToken.decimals || 18;
      const amountWei = ethers.parseUnits(amountStr, decimals);

      const hash = await executeAbsoluteSecureTransak({
        provider,
        signer,
        recipientAddress: recipient,
        amountUSDC: amountWei,
        tokenAddress: tokenAddress,
        tokenDecimals: decimals,
        signal: controller.signal,
        onStatusUpdate: (msg) => {
          setStatus(msg);
          setDebugInfo(prev => prev + msg + '\n');
        }
      });

      setTxHash(hash);
      setStatus("🎉 Transaction Successful and Secure! Session destroyed.");
      setStatusType('success');
      saveTransaction(hash, selectedToken.symbol, amountStr, recipient);
      toast.success('Transaction completed successfully!');
    } catch (err) {
      console.error(err);
      const isAbort = err.message === "MANUAL_ABORT" || err.message.includes("aborted");
      setStatus(isAbort
        ? "🛑 Transaction aborted. Funds have been recovered."
        : err.message || 'Transaction cancelled or encountered an issue.'
      );
      setStatusType('error');
      toast.error(isAbort ? 'Transaction aborted. Funds recovered.' : err.message || 'Transaction failed');
    } finally {
      setLoading(false);
      setAbortController(null);
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).then(() => {
      toast.success('Address copied!');
    }).catch(() => {});
  };

  const handleAddAddress = () => {
    if (!isAddress(newAddress)) {
      toast.error('Invalid Ethereum address');
      return;
    }
    if (!newTag.trim()) {
      toast.error('Please enter a tag/name');
      return;
    }
    if (addressBook.find(entry => entry.address.toLowerCase() === newAddress.toLowerCase())) {
      toast.error('Address already in book');
      return;
    }
    const updated = [...addressBook, { id: Date.now(), address: newAddress, tag: newTag.trim() }];
    setAddressBook(updated);
    saveAddressBook(updated); // FIXED
    setNewAddress('');
    setNewTag('');
    toast.success('Address added to book');
  };

  const handleDeleteAddress = (id) => {
    const updated = addressBook.filter(entry => entry.id !== id);
    setAddressBook(updated);
    saveAddressBook(updated); // FIXED
    toast.success('Address removed');
  };

  const handleSelectAddress = (addr) => {
    setRecipient(addr);
    setShowBookmarks(false);
  };

  const totalPages = Math.max(1, Math.ceil(transactions.length / ITEMS_PER_PAGE));
  const paginatedHistory = transactions.slice(
    (historyPage - 1) * ITEMS_PER_PAGE,
    historyPage * ITEMS_PER_PAGE
  );

  const goToPage = (page) => {
    if (page >= 1 && page <= totalPages) setHistoryPage(page);
  };

  const renderPagination = () => {
    if (totalPages <= 1) return null;
    const pages = Array.from({ length: totalPages }, (_, i) => i + 1);

    return (
      <div style={{
        display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '6px', marginTop: '12px', flexWrap: 'wrap'
      }}>
        <button
          onClick={() => goToPage(historyPage - 1)}
          disabled={historyPage === 1}
          style={{
            padding: '4px 10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)',
            background: 'transparent', color: historyPage === 1 ? '#64748b' : '#e2e8f0',
            cursor: historyPage === 1 ? 'not-allowed' : 'pointer', fontSize: '12px', transition: 'all 0.2s'
          }}
        >
          ◀
        </button>
        {pages.map((page) => (
          <button
            key={page}
            onClick={() => goToPage(page)}
            style={{
              padding: '4px 12px', borderRadius: '6px',
              border: page === historyPage ? '1px solid #8b5cf6' : '1px solid rgba(255,255,255,0.1)',
              background: page === historyPage ? 'rgba(139,92,246,0.2)' : 'transparent',
              color: page === historyPage ? '#a78bfa' : '#e2e8f0',
              cursor: 'pointer', fontSize: '12px', fontWeight: page === historyPage ? '600' : '400', transition: 'all 0.2s'
            }}
          >
            {page}
          </button>
        ))}
        <button
          onClick={() => goToPage(historyPage + 1)}
          disabled={historyPage === totalPages}
          style={{
            padding: '4px 10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)',
            background: 'transparent', color: historyPage === totalPages ? '#64748b' : '#e2e8f0',
            cursor: historyPage === totalPages ? 'not-allowed' : 'pointer', fontSize: '12px', transition: 'all 0.2s'
          }}
        >
          ▶
        </button>
      </div>
    );
  };

  const getStatusProps = () => {
    switch (statusType) {
      case 'success': return { icon: ICONS.check, bg: '#f0fdf4', border: '#86efac', color: '#065f46' };
      case 'error': return { icon: ICONS.error, bg: '#fef2f2', border: '#fca5a5', color: '#991b1b' };
      case 'loading': return { icon: ICONS.loading, bg: '#eff6ff', border: '#93c5fd', color: '#1e40af' };
      default: return { icon: ICONS.info, bg: '#f8fafc', border: '#e2e8f0', color: '#475569' };
    }
  };
  const currentStatus = getStatusProps();

  return (
    <div style={{
      minHeight: '100vh', background: 'linear-gradient(145deg, #0f172a 0%, #1e293b 100%)',
      display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '16px',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      <Toaster position="top-right" toastOptions={{
        duration: 4000,
        style: { background: '#1e293b', color: '#f1f5f9', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' },
      }} />
      <div style={{
        width: '100%', maxWidth: isDesktop ? '640px' : '560px', backgroundColor: 'rgba(255,255,255,0.05)',
        backdropFilter: 'blur(20px)', borderRadius: '32px', padding: '32px', boxSizing: 'border-box',
        border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.8)'
      }}>
        <Header isConnected={isConnected} address={address} open={open} />
        <AccountInfo isConnected={isConnected} networkName={networkName} balance={balance} />

        <form onSubmit={handleSecureSend} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <TokenSelector
            isConnected={isConnected} tokenBalances={tokenBalances}
            selectedToken={selectedToken} setSelectedToken={setSelectedToken}
          />

          <DestinationInput
            recipient={recipient} setRecipient={setRecipient} addressBook={addressBook}
            showBookmarks={showBookmarks} setShowBookmarks={setShowBookmarks}
            newAddress={newAddress} setNewAddress={setNewAddress} newTag={newTag} setNewTag={setNewTag}
            handleAddAddress={handleAddAddress} handleDeleteAddress={handleDeleteAddress}
            handleSelectAddress={handleSelectAddress} copyToClipboard={copyToClipboard}
          />

          {selectedToken && (
            <div>
              <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px', fontWeight: '600', color: '#e2e8f0', marginBottom: '8px' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>{ICONS.amount}</span> Amount of {selectedToken.symbol}
                </span>
                <button type="button" onClick={handleMaxAmount} style={{
                  background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)',
                  borderRadius: '20px', padding: '2px 12px', fontSize: '11px', fontWeight: '600',
                  color: '#4ade80', cursor: 'pointer', transition: 'all 0.2s'
                }}>MAX</button>
              </label>
              <input
                type="text" placeholder={`0.0 ${selectedToken.symbol}`}
                value={tokenAmounts[selectedToken.address || 'native'] || ''}
                onChange={(e) => {
                  let val = e.target.value;
                  val = val.replace(/,/g, '.');
                  val = val.replace(/[^0-9.]/g, '');
                  const parts = val.split('.');
                  if (parts.length > 2) {
                    val = parts[0] + '.' + parts.slice(1).join('');
                  }
                  setTokenAmounts(prev => ({ 
                    ...prev, 
                    [selectedToken.address || 'native']: val 
                  }));
                }}
                style={{
                  width: '100%', padding: '14px 16px', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.1)',
                  background: 'rgba(255,255,255,0.05)', fontSize: '14px', color: '#f1f5f9', outline: 'none', fontFamily: 'monospace'
                }} required
              />
            </div>
          )}

          {loading ? (
            <button
              type="button"
              onClick={() => {
                if (abortController) {
                  abortController.abort();
                  setStatus("🛑 Kill-switch activated! Initiating emergency recovery...");
                  toast('Kill-switch activated!', { icon: '🛑' });
                }
              }}
              style={{
                width: '100%', padding: '16px', background: 'linear-gradient(135deg, #ef4444, #b91c1c)',
                color: '#fff', border: 'none', borderRadius: '40px', cursor: 'pointer', fontWeight: '700', fontSize: '16px'
              }}
            >
              <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</span> 🛑 ABORT & RECOVER FUNDS
            </button>
          ) : (
            <button
              type="submit" disabled={!isConnected || !selectedToken}
              style={{
                width: '100%', padding: '16px',
                background: (!isConnected || !selectedToken) ? 'rgba(255,255,255,0.1)' : 'linear-gradient(135deg, #22c55e, #16a34a)',
                color: '#fff', border: 'none', borderRadius: '40px', cursor: (!isConnected || !selectedToken) ? 'not-allowed' : 'pointer',
                fontWeight: '700', fontSize: '16px'
              }}
            >
              🚀 Send Securely
            </button>
          )}
        </form>

        <div style={{
          marginTop: '24px', padding: '16px 20px', backgroundColor: currentStatus.bg,
          border: `1px solid ${currentStatus.border}`, borderRadius: '16px', fontSize: '14px'
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
            <span style={{ fontSize: '20px' }}>{currentStatus.icon}</span>
            <div>
              <strong style={{ color: currentStatus.color, display: 'block', marginBottom: '2px' }}>Status Log</strong>
              <p style={{ margin: 0, color: currentStatus.color, wordBreak: 'break-word', lineHeight: '1.5' }}>{status}</p>
            </div>
          </div>
        </div>

        {debugInfo && (
          <details style={{ marginTop: '16px' }}>
            <summary style={{ color: '#94a3b8', fontSize: '13px', cursor: 'pointer' }}>🔍 Show debug log</summary>
            <div style={{
              marginTop: '8px', padding: '12px', backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: '12px',
              fontSize: '11px', maxHeight: '200px', overflowY: 'auto', whiteSpace: 'pre-wrap', color: '#cbd5e1'
            }}>
              {debugInfo}
            </div>
          </details>
        )}

        {txHash && (
          <div style={{
            marginTop: '16px', padding: '16px 20px', backgroundColor: 'rgba(34,197,94,0.08)',
            border: '1px solid #22c55e', borderRadius: '16px', fontSize: '13px', wordBreak: 'break-all'
          }}>
            <strong style={{ color: '#22c55e' }}>✅ Transaction Hash:</strong>
            <a href={`https://testnet.arcscan.app/tx/${txHash}`} target="_blank" rel="noopener noreferrer" style={{ color: '#60a5fa', display: 'block', marginTop: '4px' }}>
              {txHash} {ICONS.external}
            </a>
          </div>
        )}

        {/* Transaction History UI (Logic untouched, works perfectly) */}
        <div style={{ marginTop: '32px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ margin: 0, color: '#e2e8f0', fontSize: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              {ICONS.history} Transaction History
            </h3>
            {transactions.length > 0 && (
              <button
                onClick={() => {
                  if (window.confirm('Clear all transaction history?')) {
                    setTransactions([]); saveTransactions([]); toast.success('History cleared');
                  }
                }}
                style={{ background: 'rgba(255,0,0,0.1)', border: '1px solid rgba(255,0,0,0.2)', color: '#f87171', padding: '4px 12px', borderRadius: '40px', fontSize: '12px', cursor: 'pointer' }}
              >Clear All</button>
            )}
          </div>
          {transactions.length === 0 ? (
            <div style={{ color: '#94a3b8', fontSize: '14px', textAlign: 'center', padding: '20px 0' }}>No transactions yet.</div>
          ) : (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {paginatedHistory.map((tx, idx) => {
                  const globalIndex = (historyPage - 1) * ITEMS_PER_PAGE + idx + 1;
                  return (
                    <div key={idx} onClick={() => setExpandedTx(expandedTx === globalIndex ? null : globalIndex)} style={{ backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: '12px', padding: '12px 16px', border: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ color: '#94a3b8', fontSize: '12px', fontWeight: '500' }}>#{globalIndex}</span>
                          <span style={{ color: '#e2e8f0', fontWeight: '500', fontSize: '14px' }}>{tx.token} {parseFloat(tx.amount).toFixed(4)}</span>
                        </div>
                        <div style={{ color: '#94a3b8', fontSize: '12px' }}>{formatTime(tx.timestamp)}</div>
                      </div>
                      {expandedTx === globalIndex && (
                        <div style={{ marginTop: '10px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '10px', fontSize: '13px', color: '#cbd5e1' }}>
                          <div><strong>Hash:</strong> {tx.hash}</div>
                          <div><strong>To:</strong> {tx.recipient}</div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {renderPagination()}
            </>
          )}
        </div>
        <Footer />
      </div>
    </div>
  );
}

// src/hooks/useBalances.js
import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { KNOWN_TOKENS, NATIVE_TOKEN } from '../config/tokens';
import { fetchAllTokenBalances, fetchTokenBalancesFromExplorer } from '../utils/tokenUtils';
import { loadCachedBalances, saveCachedBalances } from '../utils/helpers';

export function useBalances(address, isConnected) {
  const [tokenBalances, setTokenBalances] = useState([]);
  const [balance, setBalance] = useState(null);
  const [networkName, setNetworkName] = useState('');

  // Load cached balances on mount
  useEffect(() => {
    const cached = loadCachedBalances();
    if (cached) {
      setTokenBalances(cached);
      const native = cached.find(t => t.isNative);
      if (native) setBalance(native.balanceFormatted);
    }
  }, []);

  // Fetch balances
  useEffect(() => {
    const fetchBalances = async () => {
      if (isConnected && address) {
        try {
          // FIX: Ensuring URL is a continuous string to prevent compile errors
          const rpcUrl = 'https://rpc.quicknode.testnet.arc.network';
          const readProvider = new ethers.JsonRpcProvider(rpcUrl);
          const nativeBal = await readProvider.getBalance(address);
          
          setBalance(ethers.formatEther(nativeBal));

          const network = await readProvider.getNetwork();
          const chainId = Number(network.chainId);
          
          let name = 'Unknown Network';
          if (chainId === 5042002) name = 'Arc Testnet';
          else if (chainId === 1) name = 'Ethereum Mainnet';
          else name = `Chain ${chainId}`;
          
          setNetworkName(name);

          let tokens = await fetchTokenBalancesFromExplorer(address);
          let usingExplorer = true;

          if (tokens === null) {
            console.warn('⚠️ Explorer API failed, falling back to RPC...');
            usingExplorer = false;
            tokens = await fetchAllTokenBalances(readProvider, address, KNOWN_TOKENS);
          } else {
            tokens = tokens.filter(t => t.symbol !== NATIVE_TOKEN.symbol);
            tokens = tokens.map(token => {
              const known = KNOWN_TOKENS.find(k => k.address.toLowerCase() === token.address.toLowerCase());
              return {
                ...token,
                logo: known ? known.logo : null
              };
            });
          }

          const nativeToken = {
            ...NATIVE_TOKEN,
            balance: nativeBal,
            balanceFormatted: ethers.formatEther(nativeBal)
          };

          const allTokens = [nativeToken, ...tokens];
          setTokenBalances(allTokens);
          saveCachedBalances(allTokens);
          console.log(`✅ Balances fetched via ${usingExplorer ? 'Explorer API' : 'RPC'}`);
        } catch (e) {
          console.warn('⚠️ Error fetching balances:', e);
          // Fallback to zero balances to avoid UI crashes
          if (tokenBalances.length === 0) {
            setTokenBalances([{
              ...NATIVE_TOKEN,
              balance: 0n,
              balanceFormatted: '0.00000000'
            }]);
          }
        }
      } else {
        setTokenBalances([]);
        setBalance(null);
        setNetworkName('');
      }
    };

    fetchBalances();
    const interval = setInterval(fetchBalances, 30000);
    return () => clearInterval(interval);
  }, [isConnected, address]);

  return { tokenBalances, setTokenBalances, balance, networkName };
}

import { ethers } from 'ethers';

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
];

/**
 * Get ERC-20 token balance for a given address (single token).
 * Uses only balanceOf() – decimals are taken from config to reduce RPC calls.
 */
export async function getTokenBalance(provider, tokenAddress, walletAddress) {
  if (!ethers.isAddress(tokenAddress)) throw new Error('Invalid token address');
  const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
  try {
    const balance = await contract.balanceOf(walletAddress);
    return { balance };
  } catch (error) {
    console.warn(`Failed to fetch balance for token ${tokenAddress}:`, error.message);
    return { balance: 0n };
  }
}

/**
 * Get all token balances in parallel (Promise.all) for speed.
 * Uses a single provider (recommended for simplicity).
 */
export async function fetchAllTokenBalances(provider, walletAddress, knownTokens) {
  const promises = knownTokens.map(async (token) => {
    try {
      const { balance } = await getTokenBalance(provider, token.address, walletAddress);
      return {
        ...token,
        balance: balance,
        decimals: token.decimals,
        balanceFormatted: ethers.formatUnits(balance, token.decimals),
      };
    } catch (e) {
      console.warn(`Skipping token ${token.symbol}:`, e.message);
      return null;
    }
  });

  const results = await Promise.all(promises);
  // Filter out any null results (failed tokens)
  return results.filter(r => r !== null);
}

/**
 * Fetch token balances using ArcScan API v2.
 * Returns array of tokens with balance already formatted.
 * If API fails, returns null to trigger fallback.
 */
export async function fetchTokenBalancesFromExplorer(walletAddress) {
  const url = `https://testnet.arcscan.app/api/v2/addresses/${walletAddress}/token-balances`;

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    // ERC-20 tokens
    const erc20Tokens = data.filter(item =>
      item.token?.type === 'ERC-20' && item.value !== undefined
    );

    return erc20Tokens.map(item => ({
      address: item.token.address_hash,
      symbol: item.token.symbol,
      name: item.token.name,
      decimals: parseInt(item.token.decimals) || 18,
      logo: item.token.icon_url || null,
      balance: BigInt(item.value),
      balanceFormatted: ethers.formatUnits(
        BigInt(item.value),
        parseInt(item.token.decimals) || 18
      ),
      isNative: false,
    }));
  } catch (error) {
    console.warn('⚠️ Explorer API failed:', error.message);
    return null; // Signal fallback to RPC
  }
}

/**
 * Transfer ERC-20 token – accepts full feeData object for EIP-1559 support.
 */
export async function transferERC20(signerOrWallet, tokenAddress, recipient, amount, gasLimit = 100000, feeDataOrConfig = null) {
  const contract = new ethers.Contract(tokenAddress, ERC20_ABI, signerOrWallet);
  const overrides = { gasLimit };

  if (feeDataOrConfig) {
    if (feeDataOrConfig.maxFeePerGas && feeDataOrConfig.maxPriorityFeePerGas) {
      overrides.maxFeePerGas = feeDataOrConfig.maxFeePerGas;
      overrides.maxPriorityFeePerGas = feeDataOrConfig.maxPriorityFeePerGas;
    } else if (feeDataOrConfig.gasPrice) {
      overrides.gasPrice = feeDataOrConfig.gasPrice;
    }
    if (feeDataOrConfig.nonce !== undefined && feeDataOrConfig.nonce !== null) {
      overrides.nonce = feeDataOrConfig.nonce;
    }
  }

  const tx = await contract.transfer(recipient, amount, overrides);
  return tx;
}
/**
 * Get token info (decimals, symbol) if needed – for custom token discovery.
 */
export async function fetchTokenInfo(provider, tokenAddress) {
  const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
  try {
    const [decimals, symbol] = await Promise.all([
      contract.decimals(),
      contract.symbol()
    ]);
    return { decimals, symbol };
  } catch {
    return null;
  }
}

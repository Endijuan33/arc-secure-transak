import type { ChainConfig } from '../types';
import cirbtcLogo from '../assets/tokens/cirbtc.svg';
import eurcLogo from '../assets/tokens/eurc.svg';
import usdcLogo from '../assets/tokens/usdc.svg';

/**
 * Chain registry.
 *
 * This file is the only place that needs editing to support an additional
 * network. Every service reads its RPC list, explorer, native currency, and gas
 * policy from the `ChainConfig` it is handed, so no chain identifier is
 * hardcoded anywhere else.
 */

const ARC_TESTNET: ChainConfig = {
  id: 5042002,
  name: 'Arc Testnet',
  network: 'arc-testnet',
  testnet: true,
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcEndpoints: [
    { url: 'https://rpc.drpc.testnet.arc.network', label: 'dRPC' },
    { url: 'https://rpc.testnet.arc.network', label: 'Arc Public' },
    { url: 'https://5042002.rpc.thirdweb.com', label: 'thirdweb' },
    { url: 'https://rpc.blockdaemon.testnet.arc.network', label: 'Blockdaemon' },
    { url: 'https://rpc.quicknode.testnet.arc.network', label: 'QuickNode' },
  ],
  explorer: {
    name: 'ArcScan',
    url: 'https://testnet.arcscan.app',
    apiBase: 'https://testnet.arcscan.app/api/v2',
  },
  knownTokens: [
    {
      address: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a',
      symbol: 'EURC',
      name: 'Euro Coin',
      decimals: 6,
      logo: eurcLogo,
    },
    {
      address: '0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF',
      symbol: 'cirBTC',
      name: 'Circle Wrapped Bitcoin',
      decimals: 8,
      logo: cirbtcLogo,
    },
  ],
  fallbackGasPriceWei: 2_000_000_000n, // 2 gwei
  gasSafetyBufferWei: 5_000_000_000_000_000n, // 0.005 native
  supportsEip1559: true,
};

/**
 * Every chain the app can talk to.
 *
 * To add a network: append a `ChainConfig` here. It becomes selectable in the
 * UI, is registered with Reown AppKit, and is picked up by the RPC pool, gas
 * estimator, history store, and explorer links automatically.
 */
export const SUPPORTED_CHAINS: readonly ChainConfig[] = [ARC_TESTNET];

/** The chain selected on first load. */
export const DEFAULT_CHAIN: ChainConfig = ARC_TESTNET;

/** Logo for the native asset, shared by every chain in the registry. */
export const NATIVE_LOGO: string = usdcLogo;

const CHAIN_BY_ID: ReadonlyMap<number, ChainConfig> = new Map(
  SUPPORTED_CHAINS.map((chain) => [chain.id, chain]),
);

/** Look up a chain, or `undefined` when it is not in the registry. */
export function findChain(chainId: number): ChainConfig | undefined {
  return CHAIN_BY_ID.get(chainId);
}

/**
 * Look up a chain, falling back to the default.
 *
 * Used on paths where an unknown chain must not break rendering, such as
 * displaying a historical transaction recorded on a chain since removed.
 */
export function resolveChain(chainId: number | null | undefined): ChainConfig {
  if (chainId === null || chainId === undefined) return DEFAULT_CHAIN;
  return CHAIN_BY_ID.get(chainId) ?? DEFAULT_CHAIN;
}

/** Build an explorer transaction URL. */
export function explorerTxUrl(chain: ChainConfig, hash: string): string {
  return `${chain.explorer.url.replace(/\/$/, '')}/tx/${hash}`;
}

/** Build an explorer address URL. */
export function explorerAddressUrl(chain: ChainConfig, address: string): string {
  return `${chain.explorer.url.replace(/\/$/, '')}/address/${address}`;
}

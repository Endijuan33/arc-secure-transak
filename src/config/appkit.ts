/**
 * Reown AppKit bootstrap.
 *
 * Kept side-effect-light: `initAppKit` is called once from `main.tsx` rather
 * than at import time, so tests can import chain config without instantiating a
 * WalletConnect client.
 */

import { createAppKit } from '@reown/appkit/react';
import { EthersAdapter } from '@reown/appkit-adapter-ethers';
import { defineChain } from '@reown/appkit/networks';
import type { AppKitNetwork } from '@reown/appkit/networks';
import { SUPPORTED_CHAINS } from './chains';
import type { ChainConfig } from '../types';

function toAppKitNetwork(chain: ChainConfig): AppKitNetwork {
  return defineChain({
    id: chain.id,
    name: chain.name,
    network: chain.network,
    testnet: chain.testnet,
    nativeCurrency: {
      name: chain.nativeCurrency.name,
      symbol: chain.nativeCurrency.symbol,
      decimals: chain.nativeCurrency.decimals,
    },
    rpcUrls: {
      default: { http: chain.rpcEndpoints.map((endpoint) => endpoint.url) },
    },
    blockExplorers: {
      default: { name: chain.explorer.name, url: chain.explorer.url },
    },
    chainNamespace: 'eip155',
    caipNetworkId: `eip155:${chain.id}`,
    deprecatedCaipNetworkId: `eip155:${chain.id}`,
  });
}

/** Every registry chain, translated into AppKit's network shape. */
export const APPKIT_NETWORKS = SUPPORTED_CHAINS.map(toAppKitNetwork) as [
  AppKitNetwork,
  ...AppKitNetwork[],
];

function resolveProjectId(): string {
  const raw: unknown = import.meta.env.VITE_REOWN_PROJECT_ID;
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new Error(
      'VITE_REOWN_PROJECT_ID is missing. Copy .env.example to .env and set your Reown project ID.',
    );
  }
  return raw.trim();
}

function resolveAppUrl(): string {
  if (typeof window !== 'undefined' && window.location.origin.length > 0) {
    return window.location.origin;
  }
  return 'https://arc-secure-transak.vercel.app';
}

let initialized = false;

/**
 * AppKit declares `namespace?: ChainNamespace` while `EthersAdapter` exposes it
 * as `ChainNamespace | undefined`. Under `exactOptionalPropertyTypes` those are
 * distinct types, so the adapter is widened at this single boundary rather than
 * relaxing the compiler flag for the whole project.
 */
type AppKitOptions = Parameters<typeof createAppKit>[0];
type AppKitAdapterList = NonNullable<AppKitOptions['adapters']>;

function buildAdapters(): AppKitAdapterList {
  return [new EthersAdapter()] as unknown as AppKitAdapterList;
}

/**
 * Initialise AppKit exactly once.
 *
 * Repeat calls are a no-op, which matters under React 18 StrictMode where
 * effects run twice in development.
 */
export function initAppKit(): void {
  if (initialized) return;
  initialized = true;

  createAppKit({
    adapters: buildAdapters(),
    networks: APPKIT_NETWORKS,
    projectId: resolveProjectId(),
    metadata: {
      name: 'Arc Secure Transak',
      description: 'Anti-drainer transfers routed through an encrypted ephemeral burner wallet.',
      url: resolveAppUrl(),
      icons: ['https://avatars.githubusercontent.com/u/179229932'],
    },
    /**
     * EIP-6963 is opt-in in AppKit (it defaults to `false`), but it is how every
     * modern wallet announces itself to a page. Leaving it off means an in-app
     * wallet browser is not offered as a distinct connector, so the modal steers
     * the user to the WalletConnect relay instead — and on mobile that relay path
     * deeplinks back into the wallet, which reopens the dApp on its own canonical
     * URL. That origin change is what silently drops the page out of a secure
     * context and disables `crypto.subtle`, which the key vault requires.
     *
     * Enabling it lets the injected provider be selected directly, so the origin
     * never changes.
     */
    enableEIP6963: true,
    enableInjected: true,
    features: {
      analytics: false,
      email: false,
      socials: false,
    },
  });
}

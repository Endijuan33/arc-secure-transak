/**
 * Wallet connection bridge.
 *
 * Wraps the AppKit hooks so no component imports them directly, and converts the
 * EIP-1193 provider into an ethers `BrowserProvider` plus `JsonRpcSigner`.
 *
 * The signer is created inside an effect rather than on demand because
 * `getSigner()` is async and a component cannot await during render. Recreating
 * it on every account or chain change is deliberate: a stale signer bound to a
 * disconnected account is the exact condition that produced "session expired"
 * failures mid-pipeline in the previous version.
 */

import { useEffect, useMemo, useState } from 'react';
import { BrowserProvider, type Eip1193Provider, type JsonRpcSigner } from 'ethers';
import {
  useAppKit,
  useAppKitAccount,
  useAppKitNetwork,
  useAppKitProvider,
} from '@reown/appkit/react';
import { useSessionStore } from '../store/sessionStore';
import { APPKIT_NETWORKS } from '../config/appkit';
import { findChain } from '../config/chains';
import type { ChainConfig } from '../types';

export interface WalletConnection {
  readonly isConnected: boolean;
  readonly address: string | null;
  /** The chain the wallet reports, which may differ from the selected chain. */
  readonly walletChainId: number | null;
  readonly walletChain: ChainConfig | null;
  /** True when the wallet's chain does not match the app's selected chain. */
  readonly isWrongNetwork: boolean;
  readonly browserProvider: BrowserProvider | null;
  readonly signer: JsonRpcSigner | null;
  readonly isPreparingSigner: boolean;
  openWalletModal: () => void;
  switchToSelectedChain: () => Promise<void>;
}

function isEip1193Provider(value: unknown): value is Eip1193Provider {
  if (typeof value !== 'object' || value === null || !('request' in value)) return false;
  const { request } = value;
  return typeof request === 'function';
}

function toChainId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') {
    const parsed = value.startsWith('0x') ? Number.parseInt(value, 16) : Number.parseInt(value, 10);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

export function useWallet(): WalletConnection {
  const { open } = useAppKit();
  const { address, isConnected } = useAppKitAccount();
  const { walletProvider } = useAppKitProvider<unknown>('eip155');
  const { chainId, switchNetwork, caipNetwork } = useAppKitNetwork();
  const selectedChain = useSessionStore((state) => state.chain);

  const [signerState, setSignerState] = useState<{
    readonly owner: string;
    readonly signer: JsonRpcSigner | null;
  } | null>(null);

  const browserProvider = useMemo(() => {
    if (!isConnected || !isEip1193Provider(walletProvider)) return null;
    return new BrowserProvider(walletProvider);
  }, [isConnected, walletProvider]);

  useEffect(() => {
    if (browserProvider === null || address === undefined) return;

    // `cancelled` guards against a resolved signer from a previous account
    // landing in state after the user switched wallets.
    let cancelled = false;

    browserProvider
      .getSigner(address)
      .then((resolved) => {
        if (!cancelled) setSignerState({ owner: address, signer: resolved });
      })
      .catch(() => {
        // `signer: null` records "resolution finished, and it failed", which is
        // distinct from "not resolved yet" and stops the UI claiming it is still
        // preparing forever.
        if (!cancelled) setSignerState({ owner: address, signer: null });
      });

    return () => {
      cancelled = true;
    };
  }, [browserProvider, address]);

  const walletChainId = toChainId(chainId) ?? toChainId(caipNetwork?.id);
  const walletChain = walletChainId === null ? null : (findChain(walletChainId) ?? null);

  // Tagged with its owner and filtered during render, so a signer bound to a
  // previous account is never handed to the pipeline. That stale-signer case is
  // what produced mid-pipeline "session expired" failures previously.
  const resolvedForCurrentAccount =
    address !== undefined && signerState !== null && signerState.owner === address;
  const signer = resolvedForCurrentAccount ? signerState.signer : null;

  return {
    isConnected: isConnected === true && address !== undefined,
    address: address ?? null,
    walletChainId,
    walletChain,
    isWrongNetwork: walletChainId !== null && walletChainId !== selectedChain.id,
    browserProvider,
    signer,
    // Derived rather than stored: "preparing" is exactly the window between an
    // account being known and its signer having resolved.
    isPreparingSigner:
      address !== undefined && browserProvider !== null && !resolvedForCurrentAccount,
    openWalletModal: () => {
      void open();
    },
    switchToSelectedChain: async () => {
      const network = APPKIT_NETWORKS.find((entry) => Number(entry.id) === selectedChain.id);
      if (network === undefined) return;
      // AppKit types `switchNetwork` as void-returning, but the underlying
      // adapter call is async; awaiting the result keeps a rejection from
      // surfacing as an unhandled promise.
      await Promise.resolve(switchNetwork(network));
    },
  };
}

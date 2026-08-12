/**
 * Transfer orchestration for the UI.
 *
 * Owns the translation from raw form fields to a validated `TransferRequest`,
 * then delegates execution to the store. Validation happens here rather than in
 * the store so the submit button can be disabled with a reason before the user
 * clicks, and so the pipeline receives values that are already sound.
 */

import { useCallback, useMemo } from 'react';
import type { ChainConfig, NftAsset, TokenBalance, TransferRequest } from '../types';
import { validateAmount, validateRecipient, validateTokenId } from '../security/validation';
import { useTransferStore } from '../store/transferStore';
import { useSessionStore } from '../store/sessionStore';
import type { WalletConnection } from './useWallet';

export interface TransferDraft {
  readonly recipient: string;
  readonly amount: string;
  readonly asset: TokenBalance | null;
  readonly nft: NftAsset | null;
  readonly nftAmount: string;
}

export type DraftValidation =
  | { readonly ok: true; readonly request: TransferRequest }
  | { readonly ok: false; readonly error: string };

/**
 * Turn a draft into a validated request.
 *
 * Exported for direct unit testing: it is pure, so the whole form-validation
 * matrix can be exercised without mounting React.
 */
export function buildTransferRequest(draft: TransferDraft, sender: string | null): DraftValidation {
  const recipientCheck = validateRecipient(draft.recipient, {
    sender: sender ?? undefined,
  });
  if (!recipientCheck.ok) return { ok: false, error: recipientCheck.error };

  if (draft.nft !== null) {
    const nft = draft.nft;
    const tokenIdCheck = validateTokenId(nft.tokenId);
    if (!tokenIdCheck.ok) return { ok: false, error: tokenIdCheck.error };

    if (nft.kind === 'erc721') {
      return {
        ok: true,
        request: {
          kind: 'erc721',
          recipient: recipientCheck.value,
          contract: nft.contract,
          tokenId: tokenIdCheck.value,
          symbol: nft.collection,
        },
      };
    }

    // ERC-1155 amounts are integer counts, so decimals are zero.
    const countCheck = validateAmount(draft.nftAmount, 0, { max: nft.amount });
    if (!countCheck.ok) return { ok: false, error: countCheck.error };
    return {
      ok: true,
      request: {
        kind: 'erc1155',
        recipient: recipientCheck.value,
        contract: nft.contract,
        tokenId: tokenIdCheck.value,
        amount: countCheck.value,
        symbol: nft.collection,
      },
    };
  }

  const asset = draft.asset;
  if (asset === null) return { ok: false, error: 'Select an asset to send.' };

  const amountCheck = validateAmount(draft.amount, asset.decimals, { max: asset.raw });
  if (!amountCheck.ok) return { ok: false, error: amountCheck.error };

  if (asset.kind === 'native') {
    return {
      ok: true,
      request: {
        kind: 'native',
        recipient: recipientCheck.value,
        amount: amountCheck.value,
        decimals: asset.decimals,
        symbol: asset.symbol,
      },
    };
  }

  if (asset.address === null) {
    return { ok: false, error: 'That token is missing its contract address.' };
  }
  return {
    ok: true,
    request: {
      kind: 'erc20',
      recipient: recipientCheck.value,
      amount: amountCheck.value,
      decimals: asset.decimals,
      symbol: asset.symbol,
      token: asset.address,
    },
  };
}

export interface TransakController {
  readonly validation: DraftValidation;
  readonly canSubmit: boolean;
  readonly blockedReason: string | null;
  submit: () => Promise<void>;
  abort: () => void;
  reset: () => void;
}

export function useTransak(
  chain: ChainConfig,
  wallet: WalletConnection,
  draft: TransferDraft,
): TransakController {
  const gasSpeed = useSessionStore((state) => state.gasSpeed);
  const execute = useTransferStore((state) => state.execute);
  const abort = useTransferStore((state) => state.abort);
  const reset = useTransferStore((state) => state.reset);
  const isRunning = useTransferStore((state) => state.isRunning);

  const validation = useMemo(
    () => buildTransferRequest(draft, wallet.address),
    [draft, wallet.address],
  );

  const blockedReason = useMemo((): string | null => {
    if (!wallet.isConnected) return 'Connect your wallet to continue.';
    if (wallet.isWrongNetwork) return `Switch your wallet to ${chain.name}.`;
    if (wallet.signer === null) {
      return wallet.isPreparingSigner ? 'Preparing your wallet…' : 'Wallet signer unavailable.';
    }
    if (isRunning) return 'A transfer is already running.';
    if (!validation.ok) return validation.error;
    return null;
  }, [wallet, chain.name, isRunning, validation]);

  const submit = useCallback(async () => {
    const signer = wallet.signer;
    const provider = wallet.browserProvider;
    if (!validation.ok || signer === null || provider === null || wallet.address === null) return;

    const displayAmount =
      validation.request.kind === 'erc721'
        ? '1'
        : validation.request.kind === 'erc1155'
          ? draft.nftAmount
          : draft.amount;

    await execute({
      chain,
      signer,
      walletProvider: provider,
      request: validation.request,
      gasSpeed,
      sender: wallet.address,
      displayAmount,
    });
  }, [wallet, validation, execute, chain, gasSpeed, draft.amount, draft.nftAmount]);

  return {
    validation,
    canSubmit: blockedReason === null,
    blockedReason,
    submit,
    abort,
    reset,
  };
}

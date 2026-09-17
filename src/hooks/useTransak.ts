/**
 * Transfer orchestration for the UI.
 *
 * Owns the translation from raw form fields to a validated `TransferRequest`,
 * then delegates execution to the store. Validation happens here rather than in
 * the store so the submit button can be disabled with a reason before the user
 * clicks, and so the pipeline receives values that are already sound.
 */

import { useCallback, useMemo } from 'react';
import type { ChainConfig, GasEstimate, NftAsset, TokenBalance, TransferRequest } from '../types';
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
    // NOTE: The max-amount check above is intentionally against the raw balance,
    // not balance-minus-gas, because `buildTransferRequest` does not receive a
    // gas estimate. The `handleMax` function in TransferPage already subtracts
    // the gas reserve from the MAX button path. The actual gas-sufficiency check
    // runs in the pipeline's preflight step (step 5), which catches any case
    // where the user typed a value that would leave nothing for fees.
    //
    // This comment is here so a future developer does not try to pass fundingWei
    // into this pure function — doing so would couple validation to an async gas
    // quote and break the synchronous submit-button-disable path.
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
  /** Advisory gas estimate from useGas, used to catch "amount leaves nothing for fees" early. */
  gasEstimate?: GasEstimate | null,
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

    // C-4: for native transfers, warn early when the amount typed would leave
    // insufficient balance to also cover the burner funding (gas). The pipeline
    // would catch this at preflight anyway, but blocking the submit button
    // before the user signs anything gives a much better UX.
    if (
      validation.request.kind === 'native' &&
      gasEstimate !== null &&
      gasEstimate !== undefined &&
      draft.asset !== null
    ) {
      const funding =
        gasEstimate.gasLimit * gasEstimate.fee.effectiveGasPrice +
        // sweep reserve: 21000 * effectiveGasPrice
        21000n * gasEstimate.fee.effectiveGasPrice;
      const needed = validation.request.amount + funding;
      if (draft.asset.raw < needed) {
        return `Amount plus fees exceeds your ${chain.nativeCurrency.symbol} balance. Reduce the amount or wait for the fee estimate to update.`;
      }
    }

    return null;
  }, [
    wallet,
    chain.name,
    chain.nativeCurrency.symbol,
    isRunning,
    validation,
    gasEstimate,
    draft.asset,
  ]);

  // Destructure stable primitives from wallet so the callback only re-creates
  // when something that actually changes the transaction changes — not on every
  // wallet object identity change caused by a re-render.
  const { signer, browserProvider, address: walletAddress } = wallet;

  const submit = useCallback(async () => {
    if (!validation.ok || signer === null || browserProvider === null || walletAddress === null)
      return;

    const displayAmount =
      validation.request.kind === 'erc721'
        ? '1'
        : validation.request.kind === 'erc1155'
          ? draft.nftAmount
          : draft.amount;

    await execute({
      chain,
      signer,
      walletProvider: browserProvider,
      request: validation.request,
      gasSpeed,
      sender: walletAddress,
      displayAmount,
    });
  }, [
    signer,
    browserProvider,
    walletAddress,
    validation,
    execute,
    chain,
    gasSpeed,
    draft.amount,
    draft.nftAmount,
  ]);

  return {
    validation,
    canSubmit: blockedReason === null,
    blockedReason,
    submit,
    abort,
    reset,
  };
}

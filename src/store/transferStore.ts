/**
 * Transfer store: pipeline progress, the abort controller, and the result.
 *
 * The store owns the whole lifecycle so the UI never touches the service layer
 * directly. It is also the single enforcement point for the rate limiter, which
 * matters because a component could otherwise call the service twice from two
 * different buttons.
 */

import { create } from 'zustand';
import type {
  ActivityLogEntry,
  ChainConfig,
  GasSpeed,
  NewTransactionRecord,
  NotificationLevel,
  PipelineStep,
  TransactionStatus,
  TransferRequest,
} from '../types';
import type { JsonRpcSigner, Provider } from 'ethers';
import {
  RecoveryFailure,
  executeSecureTransak,
  type PipelineEvent,
  type TransakResult,
} from '../services/transak.service';
import { appendTransaction, updateTransactionStatus } from '../services/history.service';
import { destroySession, type SessionHandle } from '../security/keyVault';
import { transactionRateLimiter } from '../security/rateLimiter';
import { RateLimitError, isAbortError, toUserMessage } from '../services/errors';
import { applyStepEvent, createInitialSteps, failRemainingSteps, stepLabel } from './pipeline';
import { notify } from './notificationStore';

/**
 * Held when recovery failed and the burner still has funds.
 *
 * The handle keeps the vault session alive so the user can reveal the key from a
 * modal. Clearing this state destroys the session, which is why dismissing the
 * modal is an explicit, deliberate action.
 */
export interface StrandedFunds {
  readonly burnerAddress: string;
  readonly handle: SessionHandle;
  readonly reason: string;
}

interface TransferState {
  readonly steps: readonly PipelineStep[];
  readonly isRunning: boolean;
  readonly status: TransactionStatus | 'idle';
  readonly statusMessage: string;
  readonly log: readonly ActivityLogEntry[];
  readonly result: TransakResult | null;
  readonly error: string | null;
  readonly stranded: StrandedFunds | null;
  readonly activeRecordId: number | null;

  execute: (params: {
    readonly chain: ChainConfig;
    readonly signer: JsonRpcSigner;
    readonly walletProvider: Provider;
    readonly request: TransferRequest;
    readonly gasSpeed: GasSpeed;
    readonly sender: string;
    readonly displayAmount: string;
  }) => Promise<TransakResult | null>;

  abort: () => void;
  reset: () => void;
  /** Destroy the stranded session and clear the recovery banner. */
  dismissStranded: () => void;
}

/**
 * The live `AbortController`.
 *
 * Kept outside the store: it is not render-relevant, and storing a mutable
 * controller in state would make every abort trigger a re-render of every
 * subscriber for no visual change.
 */
let activeController: AbortController | null = null;

const MAX_LOG_LINES = 200;

/**
 * Map a pipeline phase to a display severity.
 *
 * `skipped` is informational rather than a warning: a native transfer legitimately
 * has no asset-forwarding leg, and flagging that as a problem would train users to
 * ignore real warnings.
 */
function levelForPhase(phase: PipelineEvent['phase']): NotificationLevel {
  switch (phase) {
    case 'done':
      return 'success';
    case 'skipped':
      return 'info';
    case 'start':
    case 'progress':
      return 'info';
  }
}

function amountForRecord(request: TransferRequest, displayAmount: string): string {
  return request.kind === 'erc721' ? '1' : displayAmount;
}

function tokenIdForRecord(request: TransferRequest): string | null {
  return request.kind === 'erc721' || request.kind === 'erc1155'
    ? request.tokenId.toString()
    : null;
}

export const useTransferStore = create<TransferState>((set, get) => ({
  steps: createInitialSteps(),
  isRunning: false,
  status: 'idle',
  statusMessage: 'Connect your wallet to begin.',
  log: [],
  result: null,
  error: null,
  stranded: null,
  activeRecordId: null,

  execute: async ({ chain, signer, walletProvider, request, gasSpeed, sender, displayAmount }) => {
    if (get().isRunning) {
      notify.warning('Already running', 'A transfer is already in progress.');
      return null;
    }

    // Rate limiting is enforced here, before any wallet interaction, so a
    // throttled attempt costs the user nothing.
    const decision = transactionRateLimiter.tryConsume();
    if (!decision.allowed) {
      const error = new RateLimitError(decision.reason, decision.retryAfterMs);
      set({ error: error.message, status: 'failed', statusMessage: error.message });
      notify.warning('Slow down', error.message);
      return null;
    }

    const controller = new AbortController();
    activeController = controller;

    set({
      steps: createInitialSteps(),
      isRunning: true,
      status: 'pending',
      statusMessage: 'Starting the secure pipeline…',
      log: [],
      result: null,
      error: null,
    });

    // A pending row is written up front so an interrupted run (closed tab, lost
    // power) still leaves a trace the user can reconcile against the explorer.
    let recordId: number | null = null;
    const pendingRecord: NewTransactionRecord = {
      hash: '',
      chainId: chain.id,
      kind: request.kind,
      symbol: request.symbol,
      amount: amountForRecord(request, displayAmount),
      recipient: request.recipient,
      sender,
      burner: '',
      tokenId: tokenIdForRecord(request),
      status: 'pending',
      timestamp: Date.now(),
      blockNumber: null,
      gasUsed: null,
      errorMessage: null,
    };
    try {
      const created = await appendTransaction(pendingRecord);
      recordId = created.id;
      set({ activeRecordId: created.id });
    } catch {
      // History is a convenience, not a prerequisite for transferring.
    }

    // Anchors the log's relative timeline. Set once per run so every entry's
    // `elapsedMs` is measured from the same origin.
    const runStartedAt = Date.now();
    let logSequence = 0;

    const onEvent = (event: PipelineEvent): void => {
      set((state) => ({
        steps: applyStepEvent(state.steps, event.step, event.phase, event.detail),
        statusMessage: event.detail,
        log: [
          ...state.log,
          {
            id: (logSequence += 1),
            at: Date.now(),
            step: event.step,
            stepLabel: stepLabel(event.step),
            phase: event.phase,
            level: levelForPhase(event.phase),
            message: event.detail,
            elapsedMs: Date.now() - runStartedAt,
          },
        ].slice(-MAX_LOG_LINES),
      }));
    };

    try {
      const result = await executeSecureTransak({
        chain,
        signer,
        walletProvider,
        request,
        gasSpeed,
        signal: controller.signal,
        onEvent,
      });

      if (recordId !== null) {
        await updateTransactionStatus(recordId, 'confirmed', {
          blockNumber: result.blockNumber,
          gasUsed: result.gasUsed === null ? null : result.gasUsed.toString(),
        }).catch(() => null);
      }

      set({
        isRunning: false,
        status: 'confirmed',
        statusMessage: 'Transfer complete. The burner session was destroyed.',
        result,
        error: null,
      });
      notify.success('Transfer complete', `${displayAmount} ${request.symbol} delivered securely.`);
      return result;
    } catch (error: unknown) {
      const aborted = isAbortError(error);
      const message = toUserMessage(error);

      if (error instanceof RecoveryFailure) {
        set({
          stranded: {
            burnerAddress: error.burnerAddress,
            handle: error.sessionHandle,
            reason: message,
          },
        });
        notify.error(
          'Funds need manual recovery',
          `Assets remain in burner ${error.burnerAddress}. Use the recovery panel.`,
        );
        // The recipient's transfer may well have gone through — a sweep failure
        // raises this too. Recording it as `failed` would misreport a delivered
        // transfer, so the row is left pending for the user to reconcile against
        // the explorer.
        if (recordId !== null) {
          await updateTransactionStatus(recordId, 'pending', {
            errorMessage: message,
          }).catch(() => null);
        }
        set((state) => ({
          steps: failRemainingSteps(state.steps, message),
          isRunning: false,
          status: 'pending',
          statusMessage: message,
          error: message,
        }));
        return null;
      }

      if (aborted) {
        notify.warning('Transfer aborted', 'Any moved assets were returned to your wallet.');
      } else {
        notify.error('Transfer failed', message);
      }

      if (recordId !== null) {
        await updateTransactionStatus(recordId, aborted ? 'aborted' : 'failed', {
          errorMessage: message,
        }).catch(() => null);
      }

      set((state) => ({
        steps: failRemainingSteps(state.steps, message),
        isRunning: false,
        status: aborted ? 'aborted' : 'failed',
        statusMessage: message,
        error: message,
      }));
      return null;
    } finally {
      activeController = null;
    }
  },

  abort: () => {
    if (activeController === null) return;
    activeController.abort();
    set({ statusMessage: 'Abort requested. Recovering any moved assets…' });
  },

  reset: () => {
    if (get().isRunning) return;
    set({
      steps: createInitialSteps(),
      status: 'idle',
      statusMessage: 'Ready.',
      log: [],
      result: null,
      error: null,
      activeRecordId: null,
    });
  },

  dismissStranded: () => {
    const stranded = get().stranded;
    if (stranded !== null) destroySession(stranded.handle);
    set({ stranded: null });
  },
}));

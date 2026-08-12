/**
 * Pipeline step metadata and progress reducer.
 *
 * The ten steps are declared once here so the store, the UI, and the tests all
 * agree on their identity, order, and labels.
 */

import type { PipelineStep, PipelineStepId } from '../types';

interface StepDefinition {
  readonly id: PipelineStepId;
  readonly label: string;
  /** One sentence explaining what this step does for the user. */
  readonly summary: string;
  /** True when this step asks the wallet for an approval. */
  readonly signature: boolean;
}

/** Look up a step's static metadata. */
export function stepDefinition(id: PipelineStepId): StepDefinition {
  const found = PIPELINE_DEFINITIONS.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`Unknown pipeline step: ${id}`);
  return found;
}

/** Human label for a step, or the raw id if it is somehow unknown. */
export function stepLabel(id: PipelineStepId): string {
  return PIPELINE_DEFINITIONS.find((entry) => entry.id === id)?.label ?? id;
}

/**
 * Execution order. The index shown to the user is this position plus one.
 *
 * `summary` explains what the step protects the user from, and `signature` marks
 * the two stages that require a wallet approval. Both are surfaced in the UI so
 * a user can see *why* a step exists, not just that it ran.
 */
export const PIPELINE_DEFINITIONS: readonly StepDefinition[] = [
  {
    id: 'verify-session',
    label: 'Verify wallet session',
    summary:
      'Confirms the connected signer is live and the recipient is a valid, non-blocked address.',
    signature: false,
  },
  {
    id: 'validate-network',
    label: 'Validate network',
    summary: 'Rejects the transfer if your wallet is on a different chain than the one selected.',
    signature: false,
  },
  {
    id: 'create-burner',
    label: 'Create encrypted burner',
    summary:
      'Generates a single-use key in memory and seals it with AES-256-GCM. Never written to disk.',
    signature: false,
  },
  {
    id: 'estimate-gas',
    label: 'Simulate gas',
    summary: 'Simulates the exact transfer on-chain to measure gas, rather than guessing a limit.',
    signature: false,
  },
  {
    id: 'preflight-balance',
    label: 'Pre-flight checks',
    summary: 'Verifies balances and ownership before any approval is requested from your wallet.',
    signature: false,
  },
  {
    id: 'fund-burner',
    label: 'Fund burner',
    summary: 'Your wallet sends gas to the burner — a plain transfer to an address we control.',
    signature: true,
  },
  {
    id: 'forward-asset',
    label: 'Forward asset',
    summary: 'Your wallet moves the asset to the burner. Skipped for native transfers.',
    signature: true,
  },
  {
    id: 'dispatch-final',
    label: 'Dispatch to recipient',
    summary:
      'The burner sends to the recipient. This is the only call touching an untrusted address — and your wallet does not sign it.',
    signature: false,
  },
  {
    id: 'sweep-refund',
    label: 'Sweep and refund',
    summary: 'Returns unused gas from the burner to your wallet.',
    signature: false,
  },
  {
    id: 'destroy-session',
    label: 'Destroy session',
    summary: 'Wipes the burner key from memory. Only runs once the burner is verified empty.',
    signature: false,
  },
];

/** A fresh, all-idle step list. */
export function createInitialSteps(): readonly PipelineStep[] {
  return PIPELINE_DEFINITIONS.map((definition, index) => ({
    id: definition.id,
    index: index + 1,
    label: definition.label,
    state: 'idle',
    detail: null,
    startedAt: null,
    finishedAt: null,
  }));
}

/**
 * Apply one progress event.
 *
 * Marking a step `done` also settles any earlier step still shown as active:
 * the pipeline is strictly sequential, so reaching step N proves everything
 * before it has finished, and a dropped event must not leave a stale spinner.
 */
export function applyStepEvent(
  steps: readonly PipelineStep[],
  stepId: PipelineStepId,
  phase: 'start' | 'progress' | 'done' | 'skipped' | 'failed',
  detail: string,
  now: number = Date.now(),
): readonly PipelineStep[] {
  const targetIndex = steps.findIndex((step) => step.id === stepId);
  if (targetIndex === -1) return steps;

  return steps.map((step, index) => {
    if (index < targetIndex) {
      return step.state === 'active'
        ? { ...step, state: 'done', finishedAt: step.finishedAt ?? now }
        : step;
    }
    if (index !== targetIndex) return step;

    switch (phase) {
      case 'start':
        return { ...step, state: 'active', detail, startedAt: step.startedAt ?? now };
      case 'progress':
        return { ...step, state: 'active', detail, startedAt: step.startedAt ?? now };
      case 'done':
        return {
          ...step,
          state: 'done',
          detail,
          finishedAt: now,
          startedAt: step.startedAt ?? now,
        };
      case 'skipped':
        return { ...step, state: 'skipped', detail, finishedAt: now };
      case 'failed':
        return { ...step, state: 'failed', detail, finishedAt: now };
    }
  });
}

/** Mark every unfinished step failed, used when the pipeline throws. */
export function failRemainingSteps(
  steps: readonly PipelineStep[],
  detail: string,
  now: number = Date.now(),
): readonly PipelineStep[] {
  return steps.map((step) =>
    step.state === 'active' ? { ...step, state: 'failed', detail, finishedAt: now } : step,
  );
}

/** The step currently in flight, or `null` when the pipeline is idle. */
export function activeStep(steps: readonly PipelineStep[]): PipelineStep | null {
  return steps.find((step) => step.state === 'active') ?? null;
}

/** Completion ratio in the range 0–1, counting skipped steps as complete. */
export function pipelineProgress(steps: readonly PipelineStep[]): number {
  if (steps.length === 0) return 0;
  const settled = steps.filter((step) => step.state === 'done' || step.state === 'skipped').length;
  return settled / steps.length;
}

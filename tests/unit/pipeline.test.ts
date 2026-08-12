import { describe, expect, it } from 'vitest';
import {
  PIPELINE_DEFINITIONS,
  activeStep,
  applyStepEvent,
  createInitialSteps,
  failRemainingSteps,
  pipelineProgress,
} from '../../src/store/pipeline';

describe('createInitialSteps', () => {
  it('produces the ten documented stages in order', () => {
    const steps = createInitialSteps();
    expect(steps).toHaveLength(10);
    expect(steps.map((step) => step.id)).toEqual(PIPELINE_DEFINITIONS.map((entry) => entry.id));
  });

  it('numbers the steps from one', () => {
    expect(createInitialSteps().map((step) => step.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('starts every step idle with no timing', () => {
    for (const step of createInitialSteps()) {
      expect(step.state).toBe('idle');
      expect(step.detail).toBeNull();
      expect(step.startedAt).toBeNull();
      expect(step.finishedAt).toBeNull();
    }
  });

  it('returns a fresh array each call', () => {
    expect(createInitialSteps()).not.toBe(createInitialSteps());
  });
});

describe('applyStepEvent', () => {
  it('marks a step active on start', () => {
    const steps = applyStepEvent(createInitialSteps(), 'create-burner', 'start', 'Creating…', 1000);
    const step = steps.find((entry) => entry.id === 'create-burner');

    expect(step?.state).toBe('active');
    expect(step?.detail).toBe('Creating…');
    expect(step?.startedAt).toBe(1000);
  });

  it('keeps the original start time across progress events', () => {
    let steps = applyStepEvent(createInitialSteps(), 'fund-burner', 'start', 'Approve…', 1000);
    steps = applyStepEvent(steps, 'fund-burner', 'progress', 'Waiting…', 2000);

    const step = steps.find((entry) => entry.id === 'fund-burner');
    expect(step?.startedAt).toBe(1000);
    expect(step?.detail).toBe('Waiting…');
  });

  it('records a finish time on done', () => {
    let steps = applyStepEvent(createInitialSteps(), 'estimate-gas', 'start', 'Simulating…', 1000);
    steps = applyStepEvent(steps, 'estimate-gas', 'done', 'Done', 3000);

    const step = steps.find((entry) => entry.id === 'estimate-gas');
    expect(step?.state).toBe('done');
    expect(step?.finishedAt).toBe(3000);
  });

  it('supports skipping a step', () => {
    const steps = applyStepEvent(
      createInitialSteps(),
      'forward-asset',
      'skipped',
      'Native transfer',
      1000,
    );
    expect(steps.find((entry) => entry.id === 'forward-asset')?.state).toBe('skipped');
  });

  it('settles an earlier active step when a later one starts', () => {
    // The pipeline is strictly sequential, so reaching step N proves everything
    // before it finished. A dropped `done` event must not leave a stale spinner.
    let steps = applyStepEvent(createInitialSteps(), 'verify-session', 'start', 'Checking…', 1000);
    steps = applyStepEvent(steps, 'create-burner', 'start', 'Creating…', 2000);

    expect(steps.find((entry) => entry.id === 'verify-session')?.state).toBe('done');
    expect(steps.find((entry) => entry.id === 'create-burner')?.state).toBe('active');
  });

  it('leaves later steps untouched', () => {
    const steps = applyStepEvent(createInitialSteps(), 'create-burner', 'done', 'Ready', 1000);
    expect(steps.find((entry) => entry.id === 'dispatch-final')?.state).toBe('idle');
  });

  it('marks a step failed', () => {
    let steps = applyStepEvent(createInitialSteps(), 'dispatch-final', 'start', 'Sending…', 1000);
    steps = applyStepEvent(steps, 'dispatch-final', 'failed', 'Reverted', 2000);

    const step = steps.find((entry) => entry.id === 'dispatch-final');
    expect(step?.state).toBe('failed');
    expect(step?.detail).toBe('Reverted');
  });

  it('ignores an unknown step id', () => {
    const before = createInitialSteps();
    // @ts-expect-error deliberately passing an id outside the union
    const after = applyStepEvent(before, 'not-a-step', 'start', 'x', 1000);
    expect(after).toBe(before);
  });

  it('does not mutate the input array', () => {
    const before = createInitialSteps();
    applyStepEvent(before, 'verify-session', 'start', 'Checking…', 1000);
    expect(before[0]?.state).toBe('idle');
  });
});

describe('failRemainingSteps', () => {
  it('fails only the active step', () => {
    let steps = applyStepEvent(createInitialSteps(), 'verify-session', 'done', 'ok', 1000);
    steps = applyStepEvent(steps, 'create-burner', 'start', 'Creating…', 2000);

    const failed = failRemainingSteps(steps, 'Network down', 3000);

    expect(failed.find((entry) => entry.id === 'verify-session')?.state).toBe('done');
    expect(failed.find((entry) => entry.id === 'create-burner')?.state).toBe('failed');
    expect(failed.find((entry) => entry.id === 'sweep-refund')?.state).toBe('idle');
  });

  it('is a no-op when nothing is active', () => {
    const steps = createInitialSteps();
    expect(failRemainingSteps(steps, 'boom').every((step) => step.state === 'idle')).toBe(true);
  });
});

describe('activeStep', () => {
  it('returns the in-flight step', () => {
    const steps = applyStepEvent(createInitialSteps(), 'sweep-refund', 'start', 'Sweeping…', 1000);
    expect(activeStep(steps)?.id).toBe('sweep-refund');
  });

  it('returns null when idle', () => {
    expect(activeStep(createInitialSteps())).toBeNull();
  });
});

describe('pipelineProgress', () => {
  it('is zero before anything runs', () => {
    expect(pipelineProgress(createInitialSteps())).toBe(0);
  });

  it('counts skipped steps as complete', () => {
    let steps = createInitialSteps();
    steps = applyStepEvent(steps, 'verify-session', 'done', 'ok', 1000);
    steps = applyStepEvent(steps, 'forward-asset', 'skipped', 'native', 2000);

    // Only settled steps count. Steps 2-6 are still idle here because the
    // reducer promotes an earlier step to `done` only when it was `active` —
    // it never invents completion for a step that was never started.
    expect(pipelineProgress(steps)).toBeCloseTo(0.2, 5);
  });

  it('does not credit steps that were never started', () => {
    const steps = applyStepEvent(createInitialSteps(), 'destroy-session', 'done', 'ok', 1000);
    expect(pipelineProgress(steps)).toBeCloseTo(0.1, 5);
  });

  it('reaches one when every step is done', () => {
    let steps = createInitialSteps();
    for (const definition of PIPELINE_DEFINITIONS) {
      steps = applyStepEvent(steps, definition.id, 'done', 'ok', 1000);
    }
    expect(pipelineProgress(steps)).toBe(1);
  });

  it('is zero for an empty list', () => {
    expect(pipelineProgress([])).toBe(0);
  });
});

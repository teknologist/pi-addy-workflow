import test from 'node:test';
import assert from 'node:assert/strict';
import {
  coerceWorkflowPhases,
  isPhaseStatus,
} from '../extensions/workflow-monitor/workflow-state-codec-phases.ts';
import { createInitialWorkflowState } from '../extensions/workflow-monitor/workflow-transitions.ts';

test('phase codec recognizes persisted phase statuses', () => {
  assert.equal(isPhaseStatus('pending'), true);
  assert.equal(isPhaseStatus('active'), true);
  assert.equal(isPhaseStatus('complete'), true);
  assert.equal(isPhaseStatus('skipped'), false);
});

test('phase codec coerces complete workflow phase maps', () => {
  const phases = {
    ...createInitialWorkflowState().phases,
    build: 'active',
  };

  assert.deepEqual(coerceWorkflowPhases(phases), phases);
});

test('phase codec migrates legacy ship phase to finish', () => {
  const phases = {
    ...createInitialWorkflowState().phases,
    ship: 'active',
    finish: undefined,
  };

  assert.equal(coerceWorkflowPhases(phases)?.finish, 'active');
});

test('phase codec rejects incomplete or malformed phase maps', () => {
  assert.equal(coerceWorkflowPhases(null), undefined);
  assert.equal(
    coerceWorkflowPhases({
      ...createInitialWorkflowState().phases,
      review: 'skipped',
    }),
    undefined,
  );
  const missing = { ...createInitialWorkflowState().phases } as Record<
    string,
    unknown
  >;
  delete missing.build;
  assert.equal(coerceWorkflowPhases(missing), undefined);
});

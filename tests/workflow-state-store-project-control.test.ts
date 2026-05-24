import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveWorkflowStateWithProjectControl,
  sanitizedProjectFallbackWorkflowState,
} from '../extensions/workflow-monitor/workflow-state-store-project-control.ts';
import { createInitialWorkflowState } from '../extensions/workflow-monitor/workflow-transitions.ts';

test('store project control sanitizes project fallback auto state', () => {
  const state = sanitizedProjectFallbackWorkflowState({
    ...createInitialWorkflowState(),
    autoFreshPrompt: '/addy-build docs/plans/current.md',
    autoFreshReason: 'before-step',
    autoFreshDeliveryKey: 'fresh-key',
    autoLastPrompt: '/addy-review docs/plans/old.md',
    autoReviewFixKey: 'old-review-fix',
  });

  assert.equal(state?.autoMode, true);
  assert.equal(state?.autoFreshPrompt, '/addy-build docs/plans/current.md');
  assert.equal(state?.autoLastPrompt, undefined);
  assert.equal(state?.autoReviewFixKey, undefined);
});

test('store project control revives live project auto control', () => {
  const state = resolveWorkflowStateWithProjectControl(
    createInitialWorkflowState(),
    {
      ...createInitialWorkflowState(),
      autoMode: true,
      autoPendingAction: {
        key: 'pending-key',
        prompt: '/addy-verify docs/plans/current.md',
        reason: 'idle-retry',
        attempts: 1,
        createdAt: '2026-05-24T00:00:00.000Z',
      },
    },
  );

  assert.equal(state.autoMode, true);
  assert.equal(state.autoPendingAction?.key, 'pending-key');
});

test('store project control lets consumed project fresh state replace stale branch pending state', () => {
  const state = resolveWorkflowStateWithProjectControl(
    {
      ...createInitialWorkflowState(),
      autoMode: true,
      activePlan: 'docs/plans/current.md',
      autoFreshPrompt: '/addy-build docs/plans/current.md',
      autoFreshReason: 'before-step',
      autoFreshDeliveryKey: 'fresh-key',
    },
    {
      ...createInitialWorkflowState(),
      current: 'build',
      activePlan: 'docs/plans/current.md',
      autoFreshConsumedKey: 'fresh-key',
    },
  );

  assert.equal(state.current, 'build');
  assert.equal(state.autoFreshPrompt, undefined);
  assert.equal(state.autoFreshDeliveryKey, undefined);
  assert.equal(state.autoFreshConsumedKey, 'fresh-key');
});

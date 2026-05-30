import test from 'node:test';
import assert from 'node:assert/strict';
import {
  enterAutoModeControlUpdates,
  exitAutoModeControlUpdates,
  preserveWorkflowControlState,
  stopAutoModeControlUpdates,
} from '../extensions/workflow-monitor/workflow-state-control.ts';
import { createInitialWorkflowState } from '../extensions/workflow-monitor/workflow-transitions.ts';

test('state control preserves pending fresh work when entering auto mode', () => {
  const updates = enterAutoModeControlUpdates({
    ...createInitialWorkflowState(),
    autoFreshPrompt: '/addy-build docs/plans/current.md',
    autoFreshExpandedPrompt: 'expanded prompt',
    autoFreshReason: 'before-step',
    autoFreshDeliveryKey: 'fresh-key',
    autoFreshConsumedKey: 'old-key',
    autoPendingAction: {
      key: 'pending',
      prompt: '/addy-review docs/plans/old.md',
      reason: 'idle-retry',
      attempts: 1,
      createdAt: '2026-05-23T00:00:00.000Z',
    },
    autoReviewFixKey: 'review-fix',
    reviewStatsKey: 'stats-key',
  });

  assert.equal(updates.autoMode, true);
  assert.equal(updates.autoPendingAction, undefined);
  assert.equal(updates.autoFreshPrompt, '/addy-build docs/plans/current.md');
  assert.equal(updates.autoFreshExpandedPrompt, 'expanded prompt');
  assert.equal(updates.autoFreshReason, 'before-step');
  assert.equal(updates.autoFreshDeliveryKey, 'fresh-key');
  assert.equal(updates.autoFreshConsumedKey, 'old-key');
  assert.equal(updates.autoReviewFixKey, undefined);
  assert.equal(updates.reviewStatsKey, undefined);
});

test('state control stop and exit clear auto fields with different pause reasons', () => {
  assert.deepEqual(
    {
      autoMode: stopAutoModeControlUpdates().autoMode,
      autoPausedReason: stopAutoModeControlUpdates().autoPausedReason,
      autoFreshPrompt: stopAutoModeControlUpdates().autoFreshPrompt,
      autoReviewTask: stopAutoModeControlUpdates().autoReviewTask,
    },
    {
      autoMode: false,
      autoPausedReason: 'user-stopped',
      autoFreshPrompt: undefined,
      autoReviewTask: undefined,
    },
  );
  assert.equal(exitAutoModeControlUpdates().autoPausedReason, undefined);
});

test('state control preserves control fields across phase transitions', () => {
  const source = {
    ...createInitialWorkflowState(),
    autoMode: true,
    autoLastPrompt: '/addy-review docs/plans/current.md',
    autoReviewTask: 'Review target',
    reviewStatsKey: 'review-stats',
    reviewStatsAgent: 'addy-reviewer',
  };
  const target = {
    ...createInitialWorkflowState(),
    current: 'verify' as const,
  };

  const preserved = preserveWorkflowControlState(target, source);

  assert.equal(preserved.current, 'verify');
  assert.equal(preserved.autoMode, true);
  assert.equal(preserved.autoLastPrompt, '/addy-review docs/plans/current.md');
  assert.equal(preserved.autoReviewTask, 'Review target');
  assert.equal(preserved.reviewStatsKey, 'review-stats');
  assert.equal(preserved.reviewStatsAgent, 'addy-reviewer');
});

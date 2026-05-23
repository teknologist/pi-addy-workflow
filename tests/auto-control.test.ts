import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizedProjectFallbackAutoControl,
  withProjectAutoControl,
} from '../extensions/workflow-monitor/auto-control.ts';
import { createInitialWorkflowState } from '../extensions/workflow-monitor/workflow-transitions.ts';

test('auto control project fallback preserves pending fresh prompt and clears stale review control', () => {
  const state = sanitizedProjectFallbackAutoControl({
    ...createInitialWorkflowState(),
    autoFreshPrompt: '/addy-build docs/plans/current.md',
    autoFreshExpandedPrompt: 'expanded build prompt',
    autoFreshReason: 'before-step',
    autoFreshDeliveryKey: 'fresh-key',
    autoLastPrompt: '/addy-review docs/plans/old.md',
    autoRetryKey:
      '/addy-build docs/plans/current.md\u001fdocs/plans/current.md',
    autoRetryCount: 2,
    autoReviewFixKey: 'old-review-fix',
    autoReviewFixCount: 3,
    autoReviewFindingFingerprint: 'same-finding',
    autoReviewFixNeedsReview: true,
    autoReviewTask: 'Old task',
    autoReviewTaskIndex: 4,
    reviewStatsKey: 'old-review-stats',
    reviewStatsAgent: 'addy-reviewer',
  });

  assert.equal(state.autoMode, true);
  assert.equal(state.autoFreshPrompt, '/addy-build docs/plans/current.md');
  assert.equal(state.autoFreshReason, 'before-step');
  assert.equal(state.autoRetryCount, 2);
  assert.equal(state.autoLastPrompt, undefined);
  assert.equal(state.autoReviewFixKey, undefined);
  assert.equal(state.autoReviewFixCount, undefined);
  assert.equal(state.autoReviewFindingFingerprint, undefined);
  assert.equal(state.autoReviewFixNeedsReview, undefined);
  assert.equal(state.autoReviewTask, undefined);
  assert.equal(state.autoReviewTaskIndex, undefined);
  assert.equal(state.reviewStatsKey, undefined);
  assert.equal(state.reviewStatsAgent, undefined);
});

test('auto control project fallback revives live project auto unless branch explicitly stopped', () => {
  const projectState = {
    ...createInitialWorkflowState(),
    autoMode: true,
    autoPendingAction: {
      key: 'pending-key',
      prompt: '/addy-verify docs/plans/current.md',
      reason: 'idle-retry' as const,
      attempts: 1,
      createdAt: '2026-05-22T00:00:00.000Z',
    },
  };

  assert.equal(
    withProjectAutoControl(createInitialWorkflowState(), projectState)
      .autoPendingAction?.key,
    'pending-key',
  );

  assert.equal(
    withProjectAutoControl(
      {
        ...createInitialWorkflowState(),
        autoPausedReason: 'user-stopped',
      },
      projectState,
    ).autoPendingAction,
    undefined,
  );
});

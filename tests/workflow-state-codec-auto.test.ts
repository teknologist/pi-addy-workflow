import test from 'node:test';
import assert from 'node:assert/strict';
import {
  coerceAutoPendingAction,
  isAutoPendingActionReason,
} from '../extensions/workflow-monitor/workflow-state-codec-auto.ts';

test('auto pending action codec accepts valid persisted action', () => {
  assert.deepEqual(
    coerceAutoPendingAction({
      key: 'review:1',
      prompt: '/addy-review docs/plans/task.md',
      expandedPrompt: 'expanded prompt',
      plan: 'docs/plans/task.md',
      taskId: 'task-123',
      taskIndex: 1,
      taskTitle: 'Review task',
      sliceIndex: 2,
      reason: 'next-action',
      attempts: 0,
      createdAt: '2026-05-24T00:00:00.000Z',
    }),
    {
      key: 'review:1',
      prompt: '/addy-review docs/plans/task.md',
      expandedPrompt: 'expanded prompt',
      plan: 'docs/plans/task.md',
      taskId: 'task-123',
      taskIndex: 1,
      taskTitle: 'Review task',
      sliceIndex: 2,
      reason: 'next-action',
      attempts: 0,
      createdAt: '2026-05-24T00:00:00.000Z',
    },
  );
});

test('auto pending action codec rejects invalid persisted action fields', () => {
  assert.equal(coerceAutoPendingAction(undefined), undefined);
  assert.equal(coerceAutoPendingAction([]), undefined);
  assert.equal(
    coerceAutoPendingAction({
      key: '',
      prompt: '/addy-build',
      reason: 'next-action',
      attempts: 0,
      createdAt: 'now',
    }),
    undefined,
  );
  assert.equal(
    coerceAutoPendingAction({
      key: 'build',
      prompt: '/addy-build',
      reason: 'unknown',
      attempts: 0,
      createdAt: 'now',
    }),
    undefined,
  );
  assert.equal(
    coerceAutoPendingAction({
      key: 'build',
      prompt: '/addy-build',
      reason: 'next-action',
      attempts: -1,
      createdAt: 'now',
    }),
    undefined,
  );
});

test('auto pending action reason guard accepts known persisted reasons', () => {
  assert.equal(isAutoPendingActionReason('next-action'), true);
  assert.equal(isAutoPendingActionReason('fresh-fallback'), true);
  assert.equal(isAutoPendingActionReason('idle-retry'), true);
  assert.equal(isAutoPendingActionReason('commit-frontier'), true);
  assert.equal(isAutoPendingActionReason('other'), false);
});

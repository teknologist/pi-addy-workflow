import test from 'node:test';
import assert from 'node:assert/strict';
import { planTaskClosureContinuation } from '../extensions/workflow-monitor/task-closure-continuation.ts';
import { createInitialWorkflowState } from '../extensions/workflow-monitor/workflow-transitions.ts';

const committed = {
  ...createInitialWorkflowState(),
  activePlan: 'docs/plans/slice-01.md',
  autoReviewTask: 'Closed task',
  autoReviewTaskId: 'task-1',
  autoReviewTaskIndex: 1,
};

test('task closure continuation advances to next slice and clears stale review target', () => {
  const plan = planTaskClosureContinuation({
    stateAfterCommit: committed,
    nextSlicePlan: 'docs/plans/slice-02.md',
    nextAction: () => ({ prompt: '/addy-build docs/plans/slice-02.md' }),
    freshContextBetweenTasks: false,
  });

  assert.equal(plan.kind, 'dispatch-next');
  assert.equal(plan.state.activePlan, 'docs/plans/slice-02.md');
  assert.equal(plan.state.activeSuitePlan, 'docs/plans/slice-01.md');
  assert.equal(plan.state.autoReviewTask, undefined);
});

test('task closure continuation plans between-task fresh continuation', () => {
  const plan = planTaskClosureContinuation({
    stateAfterCommit: committed,
    nextAction: () => ({
      prompt: '/addy-build docs/plans/slice-01.md',
      expandedPrompt: '# Addy Build',
    }),
    freshContextBetweenTasks: true,
    disableFreshSession: true,
  });

  assert.equal(plan.kind, 'pending-fresh');
  assert.equal(
    plan.pendingState.autoFreshPrompt,
    '/addy-build docs/plans/slice-01.md',
  );
  assert.equal(plan.pendingState.autoFreshExpandedPrompt, '# Addy Build');
  assert.equal(plan.pendingState.autoFreshReason, 'between-tasks');
  assert.equal(plan.pendingState.autoReviewTask, undefined);
  assert.equal(plan.useCurrentSession, true);
});

test('task closure continuation dispatches finish without fresh between-task handoff', () => {
  const plan = planTaskClosureContinuation({
    stateAfterCommit: committed,
    nextAction: () => ({ prompt: '/addy-finish docs/plans/slice-01.md' }),
    freshContextBetweenTasks: true,
  });

  assert.equal(plan.kind, 'dispatch-next');
});

test('task closure continuation computes next prompt from cleared continuation state', () => {
  const plan = planTaskClosureContinuation({
    stateAfterCommit: committed,
    nextSlicePlan: 'docs/plans/slice-02.md',
    nextAction: (state) => {
      assert.equal(state.activePlan, 'docs/plans/slice-02.md');
      assert.equal(state.currentTask, undefined);
      assert.equal(state.autoReviewTask, undefined);
      return { prompt: '/addy-build docs/plans/slice-02.md' };
    },
    freshContextBetweenTasks: false,
  });

  assert.equal(plan.kind, 'dispatch-next');
});

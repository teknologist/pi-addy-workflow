import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAutoAgentEnd,
  finishTextReportsComplete,
} from '../extensions/workflow-monitor/auto-agent-end.ts';
import { archiveWorkflowStats } from '../extensions/workflow-monitor/workflow-stats.ts';
import {
  createInitialWorkflowState,
  type WorkflowState,
} from '../extensions/workflow-monitor/workflow-transitions.ts';

type AutoAgentEndDeps = Parameters<typeof createAutoAgentEnd>[0];

function testAutoAgentEndDeps(
  overrides: Partial<AutoAgentEndDeps> = {},
): AutoAgentEndDeps {
  return {
    appendEntry: () => () => {},
    archiveWorkflowStats,
    actionTargetsCompletePlanTask: () => false,
    dispatchAutoPromptFreshAware: async () => {},
    dispatchNextAutoWorkflowPrompt: async () => {},
    maxReviewFixLoops: () => 3,
    maybeDispatchTaskCommit: async () => false,
    notifyWarning: () => {},
    setState: () => {},
    showWorkflowStats: () => {},
    ...overrides,
  };
}

test('auto agent-end finish text accepts explicit finish and commit evidence', () => {
  assert.equal(finishTextReportsComplete('Finished!'), true);
  assert.equal(finishTextReportsComplete('COMMIT: abc1234'), true);
  assert.equal(finishTextReportsComplete('No changes to commit'), true);
  assert.equal(finishTextReportsComplete('commit failed: rejected'), false);
  assert.equal(finishTextReportsComplete('still working'), false);
});

test('auto agent-end finish branch archives stats and clears auto state', () => {
  const appendEntries: Array<{ type: string; data: unknown }> = [];
  let persisted: WorkflowState | undefined;
  let statsHeading: string | undefined;
  const autoAgentEnd = createAutoAgentEnd(
    testAutoAgentEndDeps({
      appendEntry: () => (type, data) => appendEntries.push({ type, data }),
      setState: (_ctx, state, appendEntry) => {
        persisted = state;
        appendEntry?.('workflow-state', state);
      },
      showWorkflowStats: (_pi, _ctx, _state, options) => {
        statsHeading = options?.heading;
      },
    }),
  );
  const initial = createInitialWorkflowState();
  const state: WorkflowState = {
    ...initial,
    phases: { ...initial.phases, finish: 'active' },
    stats: {
      active: {
        tasks: {
          'docs/plan.md\u001ftask-id\u001ftask-1': {
            plan: 'docs/plan.md',
            taskId: 'task-1',
            taskTitle: 'Task one',
            turns: 3,
            verifyRuns: 1,
            reviewRuns: 1,
            issues: {
              critical: 0,
              important: 0,
              suggestion: 0,
              unknown: 0,
              total: 0,
            },
          },
        },
      },
      history: [],
    },
    autoMode: true,
    autoLastPrompt: '/addy-finish docs/plan.md',
    autoRetryKey: 'retry-key',
    autoRetryCount: 2,
    autoFreshPrompt: '/addy-finish docs/plan.md',
    autoFreshExpandedPrompt: 'expanded finish',
    autoFreshReason: 'before-step',
    autoFreshDeliveryKey: 'delivery-key',
    autoFreshConsumedKey: 'consumed-key',
    autoPendingAction: {
      key: 'pending-key',
      prompt: '/addy-finish docs/plan.md',
      reason: 'next-action',
      attempts: 1,
      createdAt: '2026-05-23T00:00:00.000Z',
    },
    autoPausedReason: 'same-phase-retry-limit',
    autoReviewFixKey: 'review-fix-key',
    autoReviewFixCount: 1,
    autoReviewFindingFingerprint: 'finding',
    autoReviewFixNeedsReview: true,
    autoReviewTask: 'Task one',
    autoReviewTaskId: 'task-1',
    autoReviewTaskIndex: 1,
    reviewStatsKey: 'review-stats',
    reviewStatsAgent: 'addy-reviewer',
  };

  const handled = autoAgentEnd.maybeCompleteAutoFinish(
    {} as never,
    {},
    'Finished!',
    state,
    { prompt: '/addy-finish docs/plan.md' },
  );

  assert.equal(handled, true);
  assert.equal(persisted?.phases.finish, 'complete');
  assert.equal(persisted?.autoMode, false);
  assert.equal(persisted?.autoLastPrompt, undefined);
  assert.equal(persisted?.autoRetryKey, undefined);
  assert.equal(persisted?.autoFreshPrompt, undefined);
  assert.equal(persisted?.autoPendingAction, undefined);
  assert.equal(persisted?.autoPausedReason, undefined);
  assert.equal(persisted?.autoReviewFixKey, undefined);
  assert.equal(persisted?.reviewStatsKey, undefined);
  assert.deepEqual(persisted?.stats?.active.tasks, {});
  assert.equal(persisted?.stats?.history.at(-1)?.endedReason, 'completed');
  assert.equal(statsHeading, 'Finished!');
  assert.equal(appendEntries.length, 1);
});

test('auto agent-end finish branch ignores non-finish turns', () => {
  let persisted = false;
  const autoAgentEnd = createAutoAgentEnd(
    testAutoAgentEndDeps({
      setState: () => {
        persisted = true;
      },
    }),
  );
  const state = {
    ...createInitialWorkflowState(),
    autoMode: true,
    autoLastPrompt: '/addy-review docs/plan.md',
  };

  assert.equal(
    autoAgentEnd.maybeCompleteAutoFinish({} as never, {}, 'Finished!', state, {
      prompt: '/addy-finish docs/plan.md',
    }),
    false,
  );
  assert.equal(persisted, false);
});

test('auto agent-end review-fix branch dispatches verify after fix-all', async () => {
  const dispatches: Array<{
    prompt: string;
    updates?: Partial<WorkflowState>;
    target?: unknown;
  }> = [];
  const autoAgentEnd = createAutoAgentEnd(
    testAutoAgentEndDeps({
      dispatchAutoPromptFreshAware: async (
        _pi,
        _ctx,
        prompt,
        _state,
        updates,
        target,
      ) => {
        dispatches.push({ prompt, updates, target });
      },
    }),
  );

  const handled = await autoAgentEnd.maybeDispatchReviewFixLoop(
    {} as never,
    {},
    '',
    {
      ...createInitialWorkflowState(),
      activePlan: 'docs/plan.md',
      autoLastPrompt: '/addy-fix-all docs/plan.md',
      autoReviewTask: 'Fix target',
      autoReviewTaskId: 'task-1',
      autoReviewTaskIndex: 2,
    },
    { prompt: '/addy-verify docs/plan.md' },
  );

  assert.equal(handled, true);
  assert.equal(dispatches[0]?.prompt, '/addy-verify docs/plan.md');
  assert.equal(dispatches[0]?.updates?.autoReviewFixNeedsReview, true);
  assert.deepEqual(dispatches[0]?.target, {
    taskIndex: 2,
    taskId: 'task-1',
    taskTitle: 'Fix target',
  });
});

test('auto agent-end review-fix branch dispatches review after post-fix verify', async () => {
  const dispatches: Array<{
    prompt: string;
    updates?: Partial<WorkflowState>;
    target?: unknown;
  }> = [];
  const autoAgentEnd = createAutoAgentEnd(
    testAutoAgentEndDeps({
      dispatchAutoPromptFreshAware: async (
        _pi,
        _ctx,
        prompt,
        _state,
        updates,
        target,
      ) => {
        dispatches.push({ prompt, updates, target });
      },
    }),
  );

  const handled = await autoAgentEnd.maybeDispatchReviewFixLoop(
    {} as never,
    {},
    '',
    {
      ...createInitialWorkflowState(),
      activePlan: 'docs/plan.md',
      currentSliceIndex: 1,
      autoLastPrompt: '/addy-verify docs/plan.md',
      autoReviewFixNeedsReview: true,
      autoReviewTask: 'Fix target',
      autoReviewTaskId: 'task-1',
      autoReviewTaskIndex: 2,
    },
    { prompt: '/addy-review docs/plan.md' },
  );

  assert.equal(handled, true);
  assert.equal(dispatches[0]?.prompt, '/addy-review docs/plan.md');
  assert.equal(dispatches[0]?.updates?.autoReviewFixNeedsReview, false);
  assert.equal(dispatches[0]?.updates?.autoReviewTask, 'Fix target');
  assert.deepEqual(dispatches[0]?.target, {
    plan: 'docs/plan.md',
    sliceIndex: 1,
    taskId: 'task-1',
    taskIndex: 2,
    taskTitle: 'Fix target',
  });
});

test('auto agent-end review-fix branch dispatches fix-all for actionable review findings', async () => {
  const dispatches: Array<{
    prompt: string;
    updates?: Partial<WorkflowState>;
  }> = [];
  const autoAgentEnd = createAutoAgentEnd(
    testAutoAgentEndDeps({
      dispatchAutoPromptFreshAware: async (
        _pi,
        _ctx,
        prompt,
        _state,
        updates,
      ) => {
        dispatches.push({ prompt, updates });
      },
    }),
  );

  const handled = await autoAgentEnd.maybeDispatchReviewFixLoop(
    {} as never,
    {},
    '- important: fix `src/server.ts:42`',
    {
      ...createInitialWorkflowState(),
      activePlan: 'docs/plan.md',
      autoLastPrompt: '/addy-review docs/plan.md',
      currentTask: 'Fix target',
      currentTaskId: 'task-1',
      currentTaskIndex: 2,
    },
    { prompt: '/addy-review docs/plan.md', taskTitle: 'Fix target' },
  );

  assert.equal(handled, true);
  assert.equal(dispatches[0]?.prompt, '/addy-fix-all docs/plan.md');
  assert.equal(dispatches[0]?.updates?.autoReviewFixCount, 1);
  assert.equal(
    typeof dispatches[0]?.updates?.autoReviewFindingFingerprint,
    'string',
  );
});

test('auto agent-end coordinator falls through to task commit before generic dispatch', async () => {
  const calls: string[] = [];
  const autoAgentEnd = createAutoAgentEnd(
    testAutoAgentEndDeps({
      maybeDispatchTaskCommit: async () => {
        calls.push('task-commit');
        return true;
      },
      dispatchNextAutoWorkflowPrompt: async () => {
        calls.push('next');
      },
    }),
  );

  await autoAgentEnd.continueAfterAgentEnd(
    {} as never,
    {},
    'clean review',
    {
      ...createInitialWorkflowState(),
      autoLastPrompt: '/addy-review docs/plan.md',
    },
    {
      ...createInitialWorkflowState(),
      autoLastPrompt: '/addy-review docs/plan.md',
    },
    { prompt: '/addy-finish docs/plan.md' },
  );

  assert.deepEqual(calls, ['task-commit']);
});

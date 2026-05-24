import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentEndHandler } from '../extensions/workflow-monitor/agent-end-handler.ts';
import {
  createInitialWorkflowState,
  type WorkflowState,
} from '../extensions/workflow-monitor/workflow-transitions.ts';

function createHarness(
  initial: WorkflowState,
  options: { providerRetry?: boolean } = {},
) {
  let state = initial;
  let appends = 0;
  let taskCommitContinuations = 0;
  let autoContinuations = 0;
  let providerRetries = 0;
  let freshSchedules = 0;
  const handler = createAgentEndHandler({
    appendEntry: () => () => {
      appends += 1;
    },
    autoAgentEndContinue: async () => {
      autoContinuations += 1;
    },
    baseCwd: () => '/repo',
    getState: () => state,
    isChildSession: () => false,
    maybeContinueAfterTaskCommit: async () => {
      taskCommitContinuations += 1;
      return false;
    },
    nextActionForState: () => ({ prompt: '/addy-review PLAN.md' }),
    preserveProviderTransportRetry: () => {
      providerRetries += 1;
      return options.providerRetry ?? false;
    },
    resumePendingFreshContinuation: async (_pi, _ctx, _options, mode) => {
      assert.equal(mode, 'after-compaction');
      if (!state.autoFreshPrompt || !state.autoFreshReason) return 'none';
      freshSchedules += 1;
      return 'delivered';
    },
    setState: (_ctx, nextState, appendEntry) => {
      state = nextState;
      appendEntry?.('workflow-state', nextState);
    },
  });

  return {
    handler,
    get appends() {
      return appends;
    },
    get autoContinuations() {
      return autoContinuations;
    },
    get freshSchedules() {
      return freshSchedules;
    },
    get providerRetries() {
      return providerRetries;
    },
    get state() {
      return state;
    },
    get taskCommitContinuations() {
      return taskCommitContinuations;
    },
  };
}

test('agent-end handler records matching review stats and stops when auto mode is off', async () => {
  const harness = createHarness({
    ...createInitialWorkflowState(),
    reviewStatsKey: 'review-task',
    reviewStatsAgent: 'addy-reviewer',
    stats: {
      active: {
        tasks: {
          'review-task': {
            taskTitle: 'Review task',
            turns: 1,
            verifyRuns: 0,
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
  });

  await harness.handler.handleAgentEnd(
    {} as never,
    {},
    {
      agentName: 'addy-reviewer',
      messages: [
        {
          role: 'assistant',
          content: [
            'Warnings:',
            '- tests/workflow-monitor.test.ts:42 missing assertion',
          ].join('\n'),
        },
      ],
    },
  );

  assert.equal(
    harness.state.stats?.active.tasks['review-task']?.issues.total,
    1,
  );
  assert.equal(harness.appends, 1);
  assert.equal(harness.autoContinuations, 0);
});

test('agent-end handler lets provider retry short-circuit auto continuation', async () => {
  const harness = createHarness(
    { ...createInitialWorkflowState(), autoMode: true },
    { providerRetry: true },
  );

  await harness.handler.handleAgentEnd(
    {} as never,
    {},
    { message: { content: 'done' } },
  );

  assert.equal(harness.providerRetries, 1);
  assert.equal(harness.autoContinuations, 0);
});

test('agent-end handler schedules pending fresh continuation before auto continuation', async () => {
  const harness = createHarness({
    ...createInitialWorkflowState(),
    autoMode: true,
    autoFreshPrompt: '/addy-review PLAN.md',
    autoFreshReason: 'before-review',
  });

  await harness.handler.handleAgentEnd(
    {} as never,
    {},
    { message: { content: 'done' } },
  );

  assert.equal(harness.freshSchedules, 1);
  assert.equal(harness.autoContinuations, 0);
});

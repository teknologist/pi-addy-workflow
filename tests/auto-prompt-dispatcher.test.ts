import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutoPromptDispatcher } from '../extensions/workflow-monitor/auto-prompt-dispatcher.ts';
import {
  createInitialWorkflowState,
  type WorkflowState,
} from '../extensions/workflow-monitor/workflow-transitions.ts';

const noFreshContext = {
  beforeEveryStep: false,
  betweenTasks: false,
  beforeReview: false,
};

function createHarness(
  initial: WorkflowState = { ...createInitialWorkflowState(), autoMode: true },
  freshContext = noFreshContext,
) {
  let state = initial;
  let appends = 0;
  let freshRuns = 0;
  let currentSessionFreshDeliveries = 0;
  let compactionSchedules = 0;
  const sent: Array<{ message: string; autoMode?: boolean }> = [];
  const failures: Array<{ message: string; error: unknown }> = [];
  const dispatcher = createAutoPromptDispatcher({
    appendEntry: () => () => {
      appends += 1;
    },
    delivery: {
      handleUserMessageDeliveryFailure: (_ctx, message, error) =>
        failures.push({ message, error }),
      safeSendUserMessage: (_pi, _ctx, message, options) =>
        sent.push({ message, autoMode: options.autoMode }),
      sendUserMessage: (_pi, _ctx, message, options) => {
        sent.push({ message, autoMode: options?.autoMode });
      },
    },
    freshContinuation: {
      resumePendingFreshContinuation: async (_pi, _ctx, _options, mode) => {
        if (mode === 'after-compaction') compactionSchedules += 1;
        else currentSessionFreshDeliveries += 1;
        return 'delivered';
      },
      runFreshContextContinuation: async () => {
        freshRuns += 1;
      },
    },
    freshContext: () => freshContext,
    getState: () => state,
    setState: (_ctx, nextState, appendEntry) => {
      state = nextState;
      appendEntry?.('workflow-state', nextState);
    },
  });

  return {
    dispatcher,
    failures,
    sent,
    get appends() {
      return appends;
    },
    get compactionSchedules() {
      return compactionSchedules;
    },
    get currentSessionFreshDeliveries() {
      return currentSessionFreshDeliveries;
    },
    get freshRuns() {
      return freshRuns;
    },
    get state() {
      return state;
    },
  };
}

test('auto prompt dispatcher sends current-session prompts and persists planned state', async () => {
  const harness = createHarness({
    ...createInitialWorkflowState(),
    autoMode: true,
    currentTask: 'Verify task',
    currentTaskIndex: 1,
  });

  await harness.dispatcher.dispatchAutoPromptFreshAware(
    {} as never,
    {},
    '/addy-verify PLAN.md',
    harness.state,
  );

  assert.equal(harness.state.autoLastPrompt, '/addy-verify PLAN.md');
  assert.equal(harness.state.current, 'verify');
  assert.equal(harness.appends, 1);
  assert.deepEqual(harness.sent, [
    { message: '/addy-verify PLAN.md', autoMode: true },
  ]);
});

test('auto prompt dispatcher starts fresh continuation when configured', async () => {
  const harness = createHarness(
    { ...createInitialWorkflowState(), autoMode: true },
    { ...noFreshContext, beforeReview: true },
  );

  await harness.dispatcher.dispatchAutoPromptFreshAware(
    {} as never,
    {},
    '/addy-review PLAN.md',
    harness.state,
  );

  assert.equal(harness.state.autoFreshPrompt, '/addy-review PLAN.md');
  assert.equal(harness.state.autoFreshReason, 'before-review');
  assert.equal(harness.freshRuns, 1);
  assert.deepEqual(harness.sent, []);
});

test('auto prompt dispatcher falls back to current session when fresh sessions are disabled', async () => {
  const harness = createHarness(
    { ...createInitialWorkflowState(), autoMode: true },
    { ...noFreshContext, beforeReview: true },
  );

  await harness.dispatcher.dispatchAutoPromptFreshAware(
    {} as never,
    {},
    '/addy-review PLAN.md',
    harness.state,
    {},
    undefined,
    { disableFreshSession: true, disableCompaction: true },
  );

  assert.equal(harness.currentSessionFreshDeliveries, 1);
  assert.equal(harness.compactionSchedules, 0);
});

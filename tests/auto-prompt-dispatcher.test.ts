import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutoPromptDispatcher } from '../extensions/workflow-monitor/auto-prompt-dispatcher.ts';
import {
  createInitialWorkflowState,
  type WorkflowState,
} from '../extensions/workflow-monitor/workflow-transitions.ts';
import {
  parsePersistedWorkflowState,
  serializeWorkflowState,
} from '../extensions/workflow-monitor/workflow-state-codec.ts';

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

test('fresh-session FINISH retry prompt carries only the durable missing-stage frontier', async () => {
  const evidence = {
    repository: '/repo',
    result: 'no-changes' as const,
    recordedAt: '2026-07-15T01:00:00.000Z',
  };
  const restored = parsePersistedWorkflowState(
    serializeWorkflowState({
      ...createInitialWorkflowState(),
      autoMode: true,
      executionSource: 'ticket',
      ticketRun: {
        schemaVersion: 1,
        source: { kind: 'github', ref: '#11' },
        runId: 'run-1',
        claim: {
          id: 'claim-1',
          owner: 'agent',
          claimedAt: '2026-07-15T00:00:00.000Z',
        },
        lifecycle: { implemented: true, verified: true, reviewed: true },
        repositoryScope: ['/repo'],
        lastValidatedResult: {
          operation: 'finish',
          outcome: 'failed',
          actionKey: 'finish-action',
          attempt: 0,
          commitEvidence: [evidence],
          finishStage: 'final-activity',
          finishActivityKind: 'final',
        },
      },
    }),
  );
  assert.ok(restored);
  const harness = createHarness(restored);

  await harness.dispatcher.dispatchAutoPromptFreshAware(
    {} as never,
    {},
    '/addy-finish --ticket #11',
    harness.state,
  );

  assert.equal(harness.freshRuns, 0);
  assert.match(
    harness.sent[0].message,
    /Completed FINISH frontier: final-activity/,
  );
  assert.match(
    harness.sent[0].message,
    /Confirmed repository evidence:.*\/repo/s,
  );
  assert.match(harness.sent[0].message, /Final Activity: confirmed/);
  assert.match(harness.sent[0].message, /Resume at terminal transition/);
});

test('partial multi-repository FINISH retry stays on repository evidence and names missing repos', async () => {
  const restored = parsePersistedWorkflowState(
    serializeWorkflowState({
      ...createInitialWorkflowState(),
      autoMode: true,
      executionSource: 'ticket',
      ticketRun: {
        schemaVersion: 1,
        source: { kind: 'github', ref: '#11' },
        runId: 'run-1',
        claim: {
          id: 'claim-1',
          owner: 'agent',
          claimedAt: '2026-07-15T00:00:00.000Z',
        },
        lifecycle: { implemented: true, verified: true, reviewed: true },
        repositoryScope: ['/repo-a', '/repo-b'],
        lastValidatedResult: {
          operation: 'finish',
          outcome: 'failed',
          actionKey: 'finish-action',
          attempt: 0,
          commitEvidence: [
            {
              repository: '/repo-a',
              result: 'no-changes',
              recordedAt: '2026-07-15T01:00:00.000Z',
            },
          ],
          finishStage: 'repository-evidence',
          finishActivityKind: 'failure',
        },
      },
    }),
  );
  assert.ok(restored);
  const harness = createHarness(restored);

  await harness.dispatcher.dispatchAutoPromptFreshAware(
    {} as never,
    {},
    '/addy-finish --ticket #11',
    harness.state,
  );

  assert.match(
    harness.sent[0].message,
    /Missing locked repositories:\s*- \/repo-b/,
  );
  assert.match(harness.sent[0].message, /Resume at repository evidence/);
  assert.match(
    harness.sent[0].message,
    /do not advance to final Activity until exact complete coverage is validated/,
  );
  assert.doesNotMatch(harness.sent[0].message, /Resume at final Activity/);
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

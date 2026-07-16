import test from 'node:test';
import assert from 'node:assert/strict';
import {
  handleAddyAutoCommand,
  type AddyAutoCommandDeps,
} from '../extensions/workflow-monitor/addy-auto-command.ts';
import {
  createInitialWorkflowState,
  type WorkflowState,
} from '../extensions/workflow-monitor/workflow-transitions.ts';
import { ADDY_AUTO_TASK_COMMIT_PROMPT } from '../extensions/workflow-monitor/workflow-tracker.ts';

function createHarness(
  initial = createInitialWorkflowState(),
  options: {
    ensureAutoRunnerOwnership?: AddyAutoCommandDeps['ensureAutoRunnerOwnership'];
    recordAutoRunnerStopIntent?: AddyAutoCommandDeps['recordAutoRunnerStopIntent'];
  } = {},
) {
  let state = initial;
  const events: unknown[] = [];
  const notifications: string[] = [];
  const delivered: string[] = [];
  const taskCommits: string[] = [];
  const watchdogs: unknown[] = [];
  let statsHeading: string | undefined;
  const deps: AddyAutoCommandDeps = {
    appendEntry: () => () => {},
    resumePendingFreshContinuation: async () => {
      if (state.autoFreshPrompt && !state.autoFreshReason) {
        notifications.push(
          'Ignoring stale Addy auto fresh continuation without a recorded reason.',
        );
        state = { ...state, autoFreshPrompt: undefined };
        return 'stale-cleared';
      }
      if (!state.autoFreshPrompt || !state.autoFreshReason) return 'none';
      delivered.push(state.autoFreshPrompt);
      return 'delivered';
    },
    dispatchTaskCommitPrompt: async (_pi, _ctx, _state, target) => {
      taskCommits.push(target.taskTitle ?? 'unknown');
    },
    getState: () => state,
    ensureAutoRunnerOwnership: options.ensureAutoRunnerOwnership,
    handleWorkflowEvent: (_ctx, event) => events.push(event),
    maybeRunAutoWatchdog: async (_pi, _ctx, source, options) => {
      watchdogs.push({ source, options });
    },
    notify: (_ctx, message) => notifications.push(message),
    recordAutoRunnerStopIntent: options.recordAutoRunnerStopIntent,
    releaseAutoRunnerLock: () => {},
    setState: (_ctx, next: WorkflowState) => {
      state = next;
    },
    showWorkflowStats: (_pi, _ctx, _state, options) => {
      statsHeading = options?.heading;
    },
  };
  return {
    deps,
    events,
    notifications,
    delivered,
    taskCommits,
    watchdogs,
    get state() {
      return state;
    },
    get statsHeading() {
      return statsHeading;
    },
  };
}

test('addy auto command clears stale pending fresh state before watchdog dispatch', async () => {
  const harness = createHarness({
    ...createInitialWorkflowState(),
    autoFreshPrompt: '/addy-build PLAN.md',
  });

  await handleAddyAutoCommand(
    {} as never,
    { args: ['PLAN.md'] },
    {},
    harness.deps,
  );

  assert.equal(
    harness.notifications[0],
    'Ignoring stale Addy auto fresh continuation without a recorded reason.',
  );
  assert.equal(harness.state.autoFreshPrompt, undefined);
  assert.deepEqual(harness.events, [
    { source: 'command', text: '/addy-auto PLAN.md', artifact: 'PLAN.md' },
  ]);
  assert.equal(harness.watchdogs.length, 1);
});

test('addy auto command stays passive when another auto runner owns the lock', async () => {
  const harness = createHarness(createInitialWorkflowState(), {
    ensureAutoRunnerOwnership: async () => false,
  });

  await handleAddyAutoCommand(
    {} as never,
    { args: ['PLAN.md'] },
    {},
    harness.deps,
  );

  assert.deepEqual(harness.events, []);
  assert.deepEqual(harness.watchdogs, []);
});

test('addy auto command refuses to retarget an owned active run', async () => {
  let ownershipChecks = 0;
  const harness = createHarness(
    {
      ...createInitialWorkflowState(),
      autoMode: true,
      activePlan: 'PLAN-A.md',
    },
    {
      ensureAutoRunnerOwnership: async () => {
        ownershipChecks += 1;
        return true;
      },
    },
  );

  await handleAddyAutoCommand(
    {} as never,
    { args: ['PLAN-B.md'] },
    {},
    harness.deps,
  );

  assert.deepEqual(harness.events, []);
  assert.equal(ownershipChecks, 0);
  assert.match(harness.notifications[0], /already running for PLAN-A\.md/);
});

test('addy auto stop from a non-owner records stop intent without mutating workflow state', async () => {
  const harness = createHarness(createInitialWorkflowState(), {
    recordAutoRunnerStopIntent: () => 'recorded',
  });

  await handleAddyAutoCommand(
    {} as never,
    { args: ['stop'] },
    {},
    harness.deps,
  );

  assert.deepEqual(harness.events, []);
  assert.match(harness.notifications[0], /stop requested/);
  assert.equal(harness.statsHeading, undefined);
});

test('addy auto command does not resume task commit from stale fresh state snapshot', async () => {
  const harness = createHarness({
    ...createInitialWorkflowState(),
    autoFreshPrompt: '/addy-build PLAN.md',
    autoLastPrompt: ADDY_AUTO_TASK_COMMIT_PROMPT,
    stats: {
      active: {
        tasks: {
          current: {
            taskTitle: 'Commit target',
            turns: 1,
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
  });

  await handleAddyAutoCommand(
    {} as never,
    { args: ['PLAN.md'] },
    {},
    harness.deps,
  );

  assert.deepEqual(harness.taskCommits, []);
  assert.equal(harness.watchdogs.length, 1);
});

test('addy auto command delivers valid pending fresh prompt before normal command handling', async () => {
  const harness = createHarness({
    ...createInitialWorkflowState(),
    autoFreshPrompt: '/addy-review PLAN.md',
    autoFreshReason: 'before-review',
  });

  const result = await handleAddyAutoCommand(
    {} as never,
    { args: ['PLAN.md'] },
    {},
    harness.deps,
  );

  assert.deepEqual(result, { action: 'continue' });
  assert.deepEqual(harness.delivered, ['/addy-review PLAN.md']);
  assert.deepEqual(harness.events, []);
  assert.deepEqual(harness.watchdogs, []);
});

test('ticket auto does not resume pending plan continuation or task commit', async () => {
  const harness = createHarness({
    ...createInitialWorkflowState(),
    activePlan: 'PLAN.md',
    autoFreshPrompt: '/addy-review PLAN.md',
    autoFreshReason: 'before-review',
    autoLastPrompt: ADDY_AUTO_TASK_COMMIT_PROMPT,
    stats: {
      active: {
        tasks: {
          current: {
            taskTitle: 'Plan commit target',
            turns: 1,
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
  });

  await handleAddyAutoCommand(
    {} as never,
    { args: ['--tickets', '--label', 'ready'] },
    {},
    harness.deps,
  );

  assert.deepEqual(harness.delivered, []);
  assert.deepEqual(harness.taskCommits, []);
  assert.deepEqual(harness.events, [
    {
      source: 'command',
      text: '/addy-auto --tickets --label ready',
      artifact: undefined,
    },
  ]);
  assert.equal(harness.watchdogs.length, 1);
});

test('each explicit ticket queue command starts a new persisted drain', async () => {
  const harness = createHarness();

  await handleAddyAutoCommand(
    {} as never,
    { args: ['--tickets', '--label', 'ready'] },
    {},
    harness.deps,
  );
  const firstDrainId = harness.state.ticketQueue?.drainId;

  await handleAddyAutoCommand(
    {} as never,
    { args: ['--tickets', '--label', 'ready'] },
    {},
    harness.deps,
  );

  assert.ok(firstDrainId);
  assert.notEqual(harness.state.ticketQueue?.drainId, firstDrainId);
});

test('addy auto command records stop and shows stats', async () => {
  const harness = createHarness();

  await handleAddyAutoCommand(
    {} as never,
    { args: ['stop'] },
    {},
    harness.deps,
  );

  assert.deepEqual(harness.events, [
    { source: 'command', text: '/addy-auto stop', artifact: undefined },
  ]);
  assert.equal(harness.statsHeading, 'Addy auto stopped.');
  assert.deepEqual(harness.watchdogs, []);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutoWatchdog } from '../extensions/workflow-monitor/auto-watchdog.ts';
import {
  createInitialWorkflowState,
  type WorkflowState,
} from '../extensions/workflow-monitor/workflow-transitions.ts';
import type { WorkflowRuntime } from '../extensions/workflow-monitor/workflow-runtime.ts';

function runtime(runOnceResult = true): WorkflowRuntime {
  return {
    canSendUserMessage: () => true,
    hasIdleSignal: () => false,
    isBusy: () => false,
    sendUserMessage: () => {},
    setEditorText: () => {},
    notify: () => {},
    notifyWarning: () => {},
    schedule: (callback) => callback(),
    runOnce: (_registry, _key, callback) => {
      if (!runOnceResult) return false;
      callback(() => {});
      return true;
    },
    getParentSession: () => undefined,
    canStartFreshSession: () => false,
    startFreshSession: async () => ({ status: 'missing' }),
  };
}

function createHarness(
  state: WorkflowState,
  options: { child?: boolean; runOnce?: boolean } = {},
) {
  let storedState = state;
  let dispatches = 0;
  let freshDeliveries = 0;
  let appends = 0;
  const watchdog = createAutoWatchdog({
    actionKeyForAction: (_state, action) => action?.prompt,
    appendEntry: () => () => {
      appends += 1;
    },
    baseCwd: () => '/repo',
    createRuntime: () => runtime(options.runOnce ?? true),
    dispatchNextAutoWorkflowPrompt: async () => {
      dispatches += 1;
    },
    getState: () => storedState,
    isChildSession: () => options.child ?? false,
    nextActionForState: () => ({ prompt: '/addy-review PLAN.md' }),
    resumePendingFreshContinuation: async () => {
      if (!storedState.autoFreshPrompt || !storedState.autoFreshReason)
        return 'none';
      freshDeliveries += 1;
      return 'delivered';
    },
    setState: (_ctx, nextState, appendEntry) => {
      storedState = nextState;
      appendEntry?.('workflow-state', nextState);
    },
  });

  return {
    watchdog,
    get appends() {
      return appends;
    },
    get dispatches() {
      return dispatches;
    },
    get freshDeliveries() {
      return freshDeliveries;
    },
    get state() {
      return storedState;
    },
  };
}

test('auto watchdog ignores child sessions and inactive auto mode', async () => {
  assert.equal(
    await createHarness(
      { ...createInitialWorkflowState(), autoMode: true },
      { child: true },
    ).watchdog.maybeRunAutoWatchdog({} as never, {}, 'session-start'),
    false,
  );
  assert.equal(
    await createHarness(
      createInitialWorkflowState(),
    ).watchdog.maybeRunAutoWatchdog({} as never, {}, 'session-start'),
    false,
  );
});

test('auto watchdog delivers pending fresh continuation first', async () => {
  const harness = createHarness({
    ...createInitialWorkflowState(),
    autoMode: true,
    autoFreshPrompt: '/addy-build PLAN.md',
    autoFreshReason: 'between-tasks',
  });

  assert.equal(
    await harness.watchdog.maybeRunAutoWatchdog(
      {} as never,
      {},
      'session-start',
    ),
    true,
  );
  assert.equal(harness.freshDeliveries, 1);
  assert.equal(harness.dispatches, 0);
});

test('auto watchdog clears stale pending action before dispatching next prompt', async () => {
  const harness = createHarness({
    ...createInitialWorkflowState(),
    autoMode: true,
    autoPendingAction: {
      key: 'stale-key',
      prompt: '/addy-build PLAN.md',
      reason: 'idle-retry',
      attempts: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  });

  assert.equal(
    await harness.watchdog.maybeRunAutoWatchdog(
      {} as never,
      {},
      'session-start',
    ),
    true,
  );
  assert.equal(harness.state.autoPendingAction, undefined);
  assert.equal(harness.appends, 1);
  assert.equal(harness.dispatches, 1);
});

test('auto watchdog treats duplicate runtime keys as handled without dispatch', async () => {
  const harness = createHarness(
    { ...createInitialWorkflowState(), autoMode: true },
    { runOnce: false },
  );

  assert.equal(
    await harness.watchdog.maybeRunAutoWatchdog(
      {} as never,
      {},
      'session-start',
    ),
    true,
  );
  assert.equal(harness.dispatches, 0);
});

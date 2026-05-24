import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionStartHandler } from '../extensions/workflow-monitor/session-start-handler.ts';
import {
  createInitialWorkflowState,
  type WorkflowState,
} from '../extensions/workflow-monitor/workflow-transitions.ts';

function createHarness(initial: WorkflowState, child = false) {
  let state = initial;
  let ensured = 0;
  let initialized = 0;
  let appends = 0;
  let freshDeliveries = 0;
  let watchdogRuns = 0;
  const warnings: string[] = [];
  const handler = createSessionStartHandler({
    resumePendingFreshContinuation: async () => {
      if (state.autoFreshPrompt && !state.autoFreshReason) {
        warnings.push(
          'Ignoring stale Addy auto fresh continuation without a recorded reason.',
        );
        state = { ...state, autoFreshPrompt: undefined };
        appends += 1;
        return 'stale-cleared';
      }
      if (!state.autoFreshPrompt || !state.autoFreshReason) return 'none';
      freshDeliveries += 1;
      return 'delivered';
    },
    ensureConfig: () => {
      ensured += 1;
    },
    initializeWidget: () => {
      initialized += 1;
      return state;
    },
    isChildSession: () => child,
    maybeRunAutoWatchdog: async () => {
      watchdogRuns += 1;
      return true;
    },
  });

  return {
    handler,
    warnings,
    get appends() {
      return appends;
    },
    get ensured() {
      return ensured;
    },
    get freshDeliveries() {
      return freshDeliveries;
    },
    get initialized() {
      return initialized;
    },
    get state() {
      return state;
    },
    get watchdogRuns() {
      return watchdogRuns;
    },
  };
}

test('session start clears stale pending fresh continuation without reason', async () => {
  const harness = createHarness({
    ...createInitialWorkflowState(),
    autoFreshPrompt: '/addy-build PLAN.md',
  });

  await harness.handler.handleSessionStart({} as never, {});

  assert.equal(harness.ensured, 1);
  assert.equal(harness.initialized, 1);
  assert.equal(harness.state.autoFreshPrompt, undefined);
  assert.equal(harness.appends, 1);
  assert.match(harness.warnings[0], /without a recorded reason/);
});

test('session start delivers valid pending fresh continuation in parent sessions', async () => {
  const harness = createHarness({
    ...createInitialWorkflowState(),
    autoFreshPrompt: '/addy-build PLAN.md',
    autoFreshReason: 'between-tasks',
  });

  await harness.handler.handleSessionStart({} as never, {});

  assert.equal(harness.freshDeliveries, 1);
  assert.equal(harness.watchdogRuns, 0);
});

test('session start falls through to watchdog when child cannot consume fresh continuation', async () => {
  const harness = createHarness(
    {
      ...createInitialWorkflowState(),
      autoMode: true,
      autoFreshPrompt: '/addy-build PLAN.md',
      autoFreshReason: 'between-tasks',
    },
    true,
  );

  await harness.handler.handleSessionStart({} as never, {});

  assert.equal(harness.freshDeliveries, 0);
  assert.equal(harness.watchdogRuns, 1);
});

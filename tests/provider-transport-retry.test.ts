import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderTransportRetryHandler } from '../extensions/workflow-monitor/provider-transport-retry.ts';
import {
  createInitialWorkflowState,
  type WorkflowState,
} from '../extensions/workflow-monitor/workflow-transitions.ts';

function createHarness(initial: WorkflowState) {
  let state = initial;
  let appended = 0;
  const warnings: string[] = [];
  const handler = createProviderTransportRetryHandler({
    appendEntry: () => () => {
      appended += 1;
    },
    autoTaskCommitPrompt: '/addy-task-commit',
    latestActiveStatsTarget: (currentState) => ({
      plan: currentState.activePlan,
      taskId: currentState.currentTaskId,
      taskTitle: currentState.currentTask,
    }),
    notifyWarning: (_ctx, message) => warnings.push(message),
    setState: (_ctx, nextState, appendEntry) => {
      state = nextState;
      appendEntry?.('workflow-state', nextState);
    },
  });

  return {
    handler,
    warnings,
    get appended() {
      return appended;
    },
    get state() {
      return state;
    },
  };
}

test('provider transport retry preserves retryable Addy prompt', () => {
  const harness = createHarness({
    ...createInitialWorkflowState(),
    activePlan: 'docs/plans/current.md',
    currentTask: 'Build module',
    currentTaskId: 'task-1',
    autoLastPrompt: '/addy-review docs/plans/current.md',
  });

  assert.equal(
    harness.handler.maybePreserveProviderTransportRetry(
      {} as never,
      {},
      {
        message: {
          stopReason: 'error',
          diagnostics: [{ type: 'provider_transport_failure' }],
        },
      },
      harness.state,
    ),
    true,
  );

  assert.equal(harness.state.autoLastPrompt, undefined);
  assert.equal(
    harness.state.autoPendingAction?.prompt,
    '/addy-review docs/plans/current.md',
  );
  assert.equal(harness.state.autoPendingAction?.taskId, 'task-1');
  assert.equal(harness.state.autoPendingAction?.reason, 'idle-retry');
  assert.equal(harness.appended, 1);
  assert.match(harness.warnings[0], /provider transport failure/);
});

test('provider transport retry preserves task commit prompt', () => {
  const harness = createHarness({
    ...createInitialWorkflowState(),
    autoLastPrompt: '/addy-task-commit',
  });

  assert.equal(
    harness.handler.maybePreserveProviderTransportRetry(
      {} as never,
      {},
      {
        message: {
          stopReason: 'error',
          diagnostics: [{ type: 'provider_transport_failure' }],
        },
      },
      harness.state,
    ),
    true,
  );

  assert.equal(harness.state.autoPendingAction?.prompt, '/addy-task-commit');
});

test('provider transport retry ignores non-provider failures and non-Addy prompts', () => {
  const providerFailure = {
    message: {
      stopReason: 'error',
      diagnostics: [{ type: 'provider_transport_failure' }],
    },
  };
  const transportHarness = createHarness({
    ...createInitialWorkflowState(),
    autoLastPrompt: 'plain text',
  });
  const otherFailureHarness = createHarness({
    ...createInitialWorkflowState(),
    autoLastPrompt: '/addy-build docs/plans/current.md',
  });

  assert.equal(
    transportHarness.handler.maybePreserveProviderTransportRetry(
      {} as never,
      {},
      providerFailure,
      transportHarness.state,
    ),
    false,
  );
  assert.equal(
    otherFailureHarness.handler.maybePreserveProviderTransportRetry(
      {} as never,
      {},
      {
        message: {
          stopReason: 'error',
          diagnostics: [{ type: 'other_error' }],
        },
      },
      otherFailureHarness.state,
    ),
    false,
  );
  assert.equal(transportHarness.state.autoPendingAction, undefined);
  assert.equal(otherFailureHarness.state.autoPendingAction, undefined);
});

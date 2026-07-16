import test from 'node:test';
import assert from 'node:assert/strict';
import { nextWorkflowActionForExecutionSource } from '../extensions/workflow-monitor/auto-lifecycle.ts';
import { createManualFrontierGuard } from '../extensions/workflow-monitor/manual-frontier-guard.ts';
import {
  createInitialWorkflowState,
  type WorkflowState,
} from '../extensions/workflow-monitor/workflow-transitions.ts';

function createGuard(state: WorkflowState) {
  const warnings: string[] = [];
  const autoPrompts: Array<{ prompt: string; useDefaultDelivery?: boolean }> =
    [];
  const taskCommits: Array<{
    taskTitle?: string;
    useDefaultDelivery?: boolean;
  }> = [];
  const guard = createManualFrontierGuard({
    actionCommitTarget: (_state, action) =>
      action?.prompt === '/addy-task-commit'
        ? { taskTitle: action.taskTitle }
        : undefined,
    baseCwd: () => '/repo',
    dispatchAutoPrompt: async (
      _pi,
      _ctx,
      prompt,
      _state,
      _updates,
      _target,
      options,
    ) => {
      autoPrompts.push({
        prompt,
        useDefaultDelivery: options?.useDefaultDelivery,
      });
    },
    dispatchTaskCommitPrompt: async (_pi, _ctx, _state, target, options) => {
      taskCommits.push({
        taskTitle: target.taskTitle,
        useDefaultDelivery: options?.useDefaultDelivery,
      });
    },
    getState: () => state,
    nextActionForState: () =>
      state.executionSource === 'ticket'
        ? nextWorkflowActionForExecutionSource(state)
        : {
            prompt:
              state.nextTask === 'commit'
                ? '/addy-task-commit'
                : '/addy-review PLAN.md',
            taskTitle: state.currentTask,
            taskId: state.currentTaskId,
            taskIndex: state.currentTaskIndex,
          },
    notify: (_ctx, message) => warnings.push(message),
  });

  return { autoPrompts, guard, taskCommits, warnings };
}

test('manual frontier guard ignores non-build commands and missing plans', async () => {
  const noPlan = createGuard(createInitialWorkflowState());
  assert.equal(
    await noPlan.guard.dispatchManualFrontierGuard(
      {} as never,
      '/addy-build PLAN.md',
      {},
    ),
    false,
  );

  const nonBuild = createGuard({
    ...createInitialWorkflowState(),
    activePlan: 'PLAN.md',
  });
  assert.equal(
    await nonBuild.guard.dispatchManualFrontierGuard(
      {} as never,
      '/addy-review PLAN.md',
      {},
    ),
    false,
  );
});

test('manual frontier guard redirects build to required frontier prompt', async () => {
  const harness = createGuard({
    ...createInitialWorkflowState(),
    activePlan: 'PLAN.md',
    currentTask: 'Verify first',
    currentTaskId: 'task-1',
    currentTaskIndex: 2,
  });

  assert.equal(
    await harness.guard.dispatchManualFrontierGuard(
      {} as never,
      '/addy-build PLAN.md',
      {},
    ),
    true,
  );

  assert.match(harness.warnings[0], /requires \/addy-review/);
  assert.deepEqual(harness.autoPrompts, [
    { prompt: '/addy-review PLAN.md', useDefaultDelivery: true },
  ]);
});

test('manual frontier guard dispatches pending task commit before more build work', async () => {
  const harness = createGuard({
    ...createInitialWorkflowState(),
    activePlan: 'PLAN.md',
    currentTask: 'Commit first',
    nextTask: 'commit',
  });

  assert.equal(
    await harness.guard.dispatchManualFrontierGuard(
      {} as never,
      '/addy-build PLAN.md',
      {},
    ),
    true,
  );

  assert.deepEqual(harness.taskCommits, [
    { taskTitle: 'Commit first', useDefaultDelivery: true },
  ]);
  assert.deepEqual(harness.autoPrompts, []);
});

function ticketState(
  lifecycle: WorkflowState['ticketRun'] extends infer _T
    ? {
        implemented: boolean;
        verified: boolean;
        reviewed: boolean;
        lastCompletedPhase?:
          | 'build'
          | 'simplify'
          | 'verify'
          | 'review'
          | 'fix-all';
      }
    : never,
  lastResult?: NonNullable<WorkflowState['ticketRun']>['lastValidatedResult'],
): WorkflowState {
  return {
    ...createInitialWorkflowState(),
    executionSource: 'ticket',
    ticketRun: {
      schemaVersion: 1,
      source: { kind: 'github', ref: '#10' },
      runId: 'run-1',
      claim: {
        id: 'claim-1',
        owner: 'agent',
        claimedAt: '2026-07-15T00:00:00.000Z',
      },
      lifecycle,
      repositoryScope: ['/repo'],
      ...(lastResult ? { lastValidatedResult: lastResult } : {}),
    },
  };
}

test('manual Ticket lifecycle other than BUILD requires the current live claim', async () => {
  const harness = createGuard(createInitialWorkflowState());
  assert.equal(
    await harness.guard.dispatchManualFrontierGuard(
      {} as never,
      '/addy-review --ticket #10',
      {},
    ),
    true,
  );
  assert.match(harness.warnings[0], /live claim/i);
  assert.deepEqual(harness.autoPrompts, []);
});

test('manual Ticket REVIEW redirects to the authoritative mandatory frontier', async () => {
  const missingBuild = createGuard(
    ticketState({ implemented: false, verified: false, reviewed: false }),
  );
  assert.equal(
    await missingBuild.guard.dispatchManualFrontierGuard(
      {} as never,
      '/addy-review --ticket #10',
      {},
    ),
    true,
  );
  assert.deepEqual(missingBuild.autoPrompts, [
    { prompt: '/addy-build --ticket #10', useDefaultDelivery: true },
  ]);

  const missingVerify = createGuard(
    ticketState({
      implemented: true,
      verified: false,
      reviewed: false,
      lastCompletedPhase: 'build',
    }),
  );
  assert.equal(
    await missingVerify.guard.dispatchManualFrontierGuard(
      {} as never,
      '/addy-review --ticket #10',
      {},
    ),
    true,
  );
  assert.deepEqual(missingVerify.autoPrompts, [
    { prompt: '/addy-verify --ticket #10', useDefaultDelivery: true },
  ]);
});

test('manual Ticket SIMPLIFY is optional only between BUILD and VERIFY', async () => {
  const valid = createGuard(
    ticketState({
      implemented: true,
      verified: false,
      reviewed: false,
      lastCompletedPhase: 'build',
    }),
  );
  assert.equal(
    await valid.guard.dispatchManualFrontierGuard(
      {} as never,
      '/addy-code-simplify --ticket #10',
      {},
    ),
    false,
  );

  const tooLate = createGuard(
    ticketState({
      implemented: true,
      verified: true,
      reviewed: false,
      lastCompletedPhase: 'verify',
    }),
  );
  assert.equal(
    await tooLate.guard.dispatchManualFrontierGuard(
      {} as never,
      '/addy-code-simplify --ticket #10',
      {},
    ),
    true,
  );
  assert.match(tooLate.warnings[0], /only after BUILD and before VERIFY/);
  assert.deepEqual(tooLate.autoPrompts, []);
});

test('manual Ticket findings require FIX-ALL then VERIFY then REVIEW', async () => {
  const findings = createGuard(
    ticketState(
      {
        implemented: true,
        verified: true,
        reviewed: false,
        lastCompletedPhase: 'review',
      },
      {
        operation: 'review',
        outcome: 'succeeded',
        actionKey: 'review-1',
        attempt: 0,
        reviewDisposition: { status: 'findings', count: 2 },
      },
    ),
  );
  await findings.guard.dispatchManualFrontierGuard(
    {} as never,
    '/addy-review --ticket #10',
    {},
  );
  assert.equal(findings.autoPrompts[0]?.prompt, '/addy-fix-all --ticket #10');

  const fixed = createGuard(
    ticketState(
      {
        implemented: true,
        verified: true,
        reviewed: false,
        lastCompletedPhase: 'fix-all',
      },
      {
        operation: 'fix-all',
        outcome: 'succeeded',
        actionKey: 'fix-1',
        attempt: 0,
      },
    ),
  );
  await fixed.guard.dispatchManualFrontierGuard(
    {} as never,
    '/addy-review --ticket #10',
    {},
  );
  assert.equal(fixed.autoPrompts[0]?.prompt, '/addy-verify --ticket #10');
});

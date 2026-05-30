import test from 'node:test';
import assert from 'node:assert/strict';
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
    nextActionForState: () => ({
      prompt:
        state.nextTask === 'commit'
          ? '/addy-task-commit'
          : '/addy-review PLAN.md',
      taskTitle: state.currentTask,
      taskId: state.currentTaskId,
      taskIndex: state.currentTaskIndex,
    }),
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

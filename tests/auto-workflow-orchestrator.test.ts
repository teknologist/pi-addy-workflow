import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutoWorkflowOrchestrator } from '../extensions/workflow-monitor/auto-workflow-orchestrator.ts';
import { autoRetryKey } from '../extensions/workflow-monitor/auto-control.ts';
import {
  createInitialWorkflowState,
  type WorkflowState,
} from '../extensions/workflow-monitor/workflow-transitions.ts';

function createHarness(
  options: {
    initial?: WorkflowState;
    nextPrompt?: string;
    autoSamePhaseMaxRetries?: number;
  } = {},
) {
  let state = options.initial ?? createInitialWorkflowState();
  const notifications: string[] = [];
  const dispatched: Array<{
    prompt: string;
    updates?: Partial<WorkflowState>;
  }> = [];
  const taskCommits: unknown[] = [];
  const orchestrator = createAutoWorkflowOrchestrator({
    appendEntry: () => () => {},
    autoPromptDispatcher: {
      dispatchAutoPromptFreshAware: async (
        _pi,
        _ctx,
        prompt,
        _state,
        updates,
      ) => {
        dispatched.push({ prompt, updates });
      },
    },
    autoSamePhaseMaxRetries: options.autoSamePhaseMaxRetries ?? 12,
    autoTaskCommitPrompt: '/addy-task-commit',
    baseCwd: () => '/repo',
    getState: () => state,
    nextActionForState: () =>
      options.nextPrompt
        ? { prompt: options.nextPrompt, taskTitle: 'Task A' }
        : undefined,
    notify: (_ctx, message) => notifications.push(message),
    setState: (_ctx, nextState) => {
      state = nextState;
    },
    taskCommitCoordinator: {
      actionCommitTarget: () => undefined,
      dispatchTaskCommitPrompt: async (...args) => {
        taskCommits.push(args);
      },
      withPlanTaskId: () => undefined,
    },
  });
  return {
    dispatched,
    notifications,
    orchestrator,
    get state() {
      return state;
    },
    taskCommits,
  };
}

test('auto workflow orchestrator warns when auto mode has no active plan prompt', async () => {
  const harness = createHarness();

  await harness.orchestrator.dispatchNextAutoWorkflowPrompt({} as never, {});

  assert.equal(
    harness.notifications[0],
    'Addy auto is active, but no active plan is available.',
  );
  assert.deepEqual(harness.dispatched, []);
});

test('auto workflow orchestrator dispatches next prompt with review target state', async () => {
  const harness = createHarness({
    initial: {
      ...createInitialWorkflowState(),
      current: 'verify',
      currentTask: 'Task A',
      currentTaskId: 'task-a',
      currentTaskIndex: 0,
    },
    nextPrompt: '/addy-review PLAN.md',
  });

  await harness.orchestrator.dispatchNextAutoWorkflowPrompt({} as never, {});

  assert.equal(harness.dispatched[0]?.prompt, '/addy-review PLAN.md');
  assert.equal(harness.dispatched[0]?.updates?.autoReviewTask, 'Task A');
  assert.equal(harness.dispatched[0]?.updates?.autoReviewTaskId, 'task-a');
});

test('auto workflow orchestrator pauses at same-phase retry limit', async () => {
  const initial = {
    ...createInitialWorkflowState(),
    current: 'review' as const,
    autoRetryCount: 1,
    currentTask: 'Task A',
  };
  const harness = createHarness({
    autoSamePhaseMaxRetries: 1,
    initial: {
      ...initial,
      autoRetryKey: autoRetryKey(initial, '/addy-review PLAN.md'),
    },
    nextPrompt: '/addy-review PLAN.md',
  });

  await harness.orchestrator.dispatchNextAutoWorkflowPrompt({} as never, {});

  assert.equal(harness.state.autoPausedReason, 'same-phase-retry-limit');
  assert.deepEqual(harness.dispatched, []);
  assert.match(harness.notifications[0] ?? '', /paused/i);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  autoWorkflowActionKey,
  autoWorkflowActionKeyForAction,
  autoWorkflowActionKeyForPromptState,
  currentAutoWorkflowActionKey,
  idleUserMessageKey,
} from '../extensions/workflow-monitor/auto-action-keys.ts';
import { ADDY_AUTO_TASK_COMMIT_PROMPT } from '../extensions/workflow-monitor/workflow-tracker.ts';
import { createInitialWorkflowState } from '../extensions/workflow-monitor/workflow-transitions.ts';

test('auto action key prefers stable task id over task title', () => {
  const first = autoWorkflowActionKey('/addy-verify docs/plan.md', {
    plan: 'docs/plan.md',
    taskId: 'task-123',
    taskIndex: 1,
    taskTitle: 'Original title',
  });
  const renamed = autoWorkflowActionKey('/addy-verify docs/plan.md', {
    plan: 'docs/plan.md',
    taskId: 'task-123',
    taskIndex: 1,
    taskTitle: 'Renamed title',
  });

  assert.equal(first, renamed);
});

test('auto action key falls back to legacy task index and title', () => {
  const first = autoWorkflowActionKey('/addy-review docs/plan.md', {
    plan: 'docs/plan.md',
    taskIndex: 1,
    taskTitle: 'Original title',
  });
  const renamed = autoWorkflowActionKey('/addy-review docs/plan.md', {
    plan: 'docs/plan.md',
    taskIndex: 1,
    taskTitle: 'Renamed title',
  });

  assert.notEqual(first, renamed);
});

test('auto action key for prompt state prefers active stats target identity', () => {
  const state = {
    ...createInitialWorkflowState(),
    activePlan: 'docs/current.md',
    currentTaskId: 'current-task',
    currentTaskIndex: 1,
    currentTask: 'Current task',
  };

  assert.equal(
    autoWorkflowActionKeyForPromptState('/addy-review docs/current.md', state, {
      plan: 'docs/review.md',
      taskId: 'review-task',
      taskIndex: 2,
      taskTitle: 'Review target',
    }),
    autoWorkflowActionKey('/addy-review docs/current.md', {
      plan: 'docs/review.md',
      taskId: 'review-task',
      taskIndex: 2,
      taskTitle: 'Review target',
    }),
  );
});

test('auto action key for prompt state preserves explicit legacy target identity', () => {
  const state = {
    ...createInitialWorkflowState(),
    activePlan: 'docs/current.md',
    currentTaskId: 'current-task-id',
    currentTaskIndex: 1,
    currentTask: 'Current task',
  };

  assert.equal(
    autoWorkflowActionKeyForPromptState('/addy-review docs/current.md', state, {
      plan: 'docs/legacy.md',
      taskIndex: 2,
      taskTitle: 'Legacy target',
    }),
    autoWorkflowActionKey('/addy-review docs/current.md', {
      plan: 'docs/legacy.md',
      taskIndex: 2,
      taskTitle: 'Legacy target',
    }),
  );
});

test('auto action key marks auto task commit prompts', () => {
  const state = {
    ...createInitialWorkflowState(),
    activePlan: 'docs/plan.md',
    currentTaskId: 'task-123',
  };

  assert.equal(
    autoWorkflowActionKeyForPromptState(
      ADDY_AUTO_TASK_COMMIT_PROMPT,
      state,
      undefined,
    ),
    autoWorkflowActionKey(ADDY_AUTO_TASK_COMMIT_PROMPT, {
      plan: 'docs/plan.md',
      taskId: 'task-123',
      requiresCommit: true,
    }),
  );
});

test('current auto action key normalizes last prompt input text', () => {
  const state = {
    ...createInitialWorkflowState(),
    activePlan: 'docs/plan.md',
    currentTaskId: 'task-123',
    autoLastPrompt: '/addy-verify docs/plan.md',
    autoPendingAction: {
      prompt: '/addy-review docs/plan.md',
      key: 'pending-key',
      reason: 'idle-retry' as const,
      attempts: 0,
      createdAt: '2026-05-23T00:00:00.000Z',
    },
  };

  assert.equal(
    currentAutoWorkflowActionKey(state, undefined),
    autoWorkflowActionKey('/addy-verify docs/plan.md', {
      plan: 'docs/plan.md',
      taskId: 'task-123',
    }),
  );
});

test('idle user message key includes context identity and message', () => {
  const first = idleUserMessageKey(
    { id: 'ctx-1', cwd: '/repo' },
    '/addy-build',
  );
  const same = idleUserMessageKey({ id: 'ctx-1', cwd: '/repo' }, '/addy-build');
  const different = idleUserMessageKey(
    { id: 'ctx-2', cwd: '/repo' },
    '/addy-build',
  );

  assert.equal(first, same);
  assert.notEqual(first, different);
  assert.equal(first.length, 16);
});

test('auto action key for action uses action task identity over state fallback', () => {
  const state = {
    ...createInitialWorkflowState(),
    activePlan: 'docs/current.md',
    currentTaskId: 'current-task',
  };
  const action = {
    prompt: '/addy-verify docs/action.md',
    plan: 'docs/action.md',
    taskId: 'action-task',
    taskIndex: 3,
    taskTitle: 'Action task',
    currentSliceIndex: 2,
  };

  assert.equal(
    autoWorkflowActionKeyForAction(state, action),
    autoWorkflowActionKey('/addy-verify docs/action.md', {
      plan: 'docs/action.md',
      taskId: 'action-task',
      sliceIndex: 2,
      taskIndex: 3,
      taskTitle: 'Action task',
    }),
  );
});

test('auto action key for action preserves explicit legacy task identity', () => {
  const state = {
    ...createInitialWorkflowState(),
    activePlan: 'docs/current.md',
    currentTaskId: 'current-task-id',
    currentTaskIndex: 1,
    currentTask: 'Current task',
  };
  const action = {
    prompt: '/addy-verify docs/action.md',
    plan: 'docs/action.md',
    taskIndex: 3,
    taskTitle: 'Legacy action task',
  };

  assert.equal(
    autoWorkflowActionKeyForAction(state, action),
    autoWorkflowActionKey('/addy-verify docs/action.md', {
      plan: 'docs/action.md',
      taskIndex: 3,
      taskTitle: 'Legacy action task',
    }),
  );
});

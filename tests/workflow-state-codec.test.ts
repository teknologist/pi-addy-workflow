import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePersistedWorkflowState,
  workflowStateFromEntry,
} from '../extensions/workflow-monitor/workflow-state-codec.ts';
import { createInitialWorkflowState } from '../extensions/workflow-monitor/workflow-transitions.ts';
import {
  WORKFLOW_STATE_ENTRY_TYPE,
  parseWorkflowState,
} from '../extensions/workflow-monitor/workflow-state-codec.ts';
import { workflowTaskCommitKey } from '../extensions/workflow-monitor/workflow-tracker.ts';

test('state codec parses string wrapper and object workflow state inputs', () => {
  const objectState = parseWorkflowState({
    ...createInitialWorkflowState(),
    current: 'build',
  });
  const stringState = parseWorkflowState(
    JSON.stringify({
      type: WORKFLOW_STATE_ENTRY_TYPE,
      state: { ...createInitialWorkflowState(), current: 'verify' },
    }),
  );

  assert.equal(objectState.current, 'build');
  assert.equal(stringState.current, 'verify');
});

test('state codec normalizes after-plan state and stats defaults', () => {
  const state = parseWorkflowState({
    ...createInitialWorkflowState(),
    current: 'review',
    phases: {
      ...createInitialWorkflowState().phases,
      review: 'active',
    },
  });

  assert.equal(state.phases.define, 'complete');
  assert.equal(state.phases.plan, 'complete');
  assert.deepEqual(state.stats, { active: { tasks: {} }, history: [] });
});

test('state codec removes invalid persisted plan artifacts', () => {
  const state = parseWorkflowState({
    ...createInitialWorkflowState(),
    activePlan: '/addy-verify',
    activeSuitePlan: '/addy-auto',
  });

  assert.equal(state.activePlan, undefined);
  assert.equal(state.activeSuitePlan, undefined);
});

test('state codec decodes persisted wrapper state and legacy ship phase', () => {
  const state = parsePersistedWorkflowState(
    JSON.stringify({
      type: WORKFLOW_STATE_ENTRY_TYPE,
      state: {
        ...createInitialWorkflowState(),
        current: 'ship',
        phases: {
          ...createInitialWorkflowState().phases,
          ship: 'active',
          finish: undefined,
        },
      },
    }),
  );

  assert.equal(state?.current, 'finish');
  assert.equal(state?.phases.finish, 'active');
});

test('state codec fails closed for invalid persisted state', () => {
  assert.equal(
    parsePersistedWorkflowState(
      JSON.stringify({
        type: WORKFLOW_STATE_ENTRY_TYPE,
        state: {
          ...createInitialWorkflowState(),
          autoMode: 'yes',
        },
      }),
    ),
    undefined,
  );
  assert.equal(parsePersistedWorkflowState('not json'), undefined);
});

test('state codec fails closed for invalid optional state fields', () => {
  for (const invalidField of [
    { lastTrigger: 42 },
    { lastArtifact: false },
    { testStatus: 'broken' },
  ]) {
    assert.equal(
      parsePersistedWorkflowState({
        ...createInitialWorkflowState(),
        ...invalidField,
      }),
      undefined,
    );
  }
});

test('state codec skips invalid committed task records', () => {
  const state = parsePersistedWorkflowState({
    ...createInitialWorkflowState(),
    activePlan: 'docs/plans/current.md',
    committedTasks: {
      valid: {
        plan: 'docs/plans/current.md',
        taskIndex: 1,
        taskTitle: 'Current task',
        commitSha: 'abc123',
        committedAt: '2026-05-22T12:00:00.000Z',
      },
      invalid: {
        plan: 'docs/plans/current.md',
        taskIndex: '1',
        taskTitle: 'Invalid task',
        commitSha: 'def456',
        committedAt: '2026-05-22T12:00:00.000Z',
      },
    },
  });

  assert.equal(state?.activePlan, 'docs/plans/current.md');
  assert.deepEqual(Object.keys(state?.committedTasks ?? {}), ['valid']);
  assert.equal(state?.committedTasks?.valid?.commitSha, 'abc123');
});

test('state codec decodes session entries', () => {
  const state = workflowStateFromEntry({
    type: 'custom',
    customType: WORKFLOW_STATE_ENTRY_TYPE,
    data: {
      ...createInitialWorkflowState(),
      current: 'review',
      activePlan: 'docs/plans/session.md',
    },
  });

  assert.equal(state?.current, 'review');
  assert.equal(state?.activePlan, 'docs/plans/session.md');
});

test('state codec backfills legacy task commit evidence from task-commit stats', () => {
  const plan = 'docs/plans/legacy.md';
  const taskTitle = 'Persist old evidence';
  const key = workflowTaskCommitKey(plan, 1, taskTitle);

  const state = parsePersistedWorkflowState({
    ...createInitialWorkflowState(),
    stats: {
      active: { tasks: {} },
      history: [
        {
          endedReason: 'task-commit',
          tasks: {
            legacy: {
              plan,
              taskIndex: 1,
              taskTitle,
              verifyRuns: 1,
              reviewRuns: 1,
            },
            buildOnly: {
              plan,
              taskIndex: 2,
              taskTitle: 'Not enough lifecycle evidence',
              verifyRuns: 1,
              reviewRuns: 0,
            },
          },
        },
      ],
    },
  });

  assert.equal(state?.committedTasks?.[key]?.committedAt, 'legacy-task-commit');
  assert.match(state?.committedTasks?.[key]?.commitSha ?? '', /^legacy:/);
  assert.equal(Object.keys(state?.committedTasks ?? {}).length, 1);
});

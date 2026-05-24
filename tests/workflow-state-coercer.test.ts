import test from 'node:test';
import assert from 'node:assert/strict';
import { coerceWorkflowState } from '../extensions/workflow-monitor/workflow-state-coercer.ts';
import { createInitialWorkflowState } from '../extensions/workflow-monitor/workflow-transitions.ts';

const initialState = createInitialWorkflowState();

test('state coercer accepts valid workflow state shape', () => {
  const state = coerceWorkflowState(initialState);

  assert.deepEqual(state?.phases, initialState.phases);
  assert.deepEqual(state?.warnings, initialState.warnings);
});

test('state coercer migrates legacy current ship phase', () => {
  const state = coerceWorkflowState({
    ...initialState,
    current: 'ship',
  });

  assert.equal(state?.current, 'finish');
});

test('state coercer fails closed for invalid subdomain fields', () => {
  assert.equal(
    coerceWorkflowState({ ...initialState, current: 'nope' }),
    undefined,
  );
  assert.equal(
    coerceWorkflowState({ ...initialState, warnings: ['ok', 1] }),
    undefined,
  );
  assert.equal(
    coerceWorkflowState({ ...initialState, autoPendingAction: { command: 1 } }),
    undefined,
  );
});

test('state coercer preserves committed task backfill migration', () => {
  const state = coerceWorkflowState({
    ...initialState,
    stats: {
      active: { tasks: {} },
      history: [
        {
          endedReason: 'task-commit',
          tasks: {
            'task-1': {
              plan: 'docs/plans/plan.md',
              taskIndex: 1,
              taskTitle: 'Build slice',
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
      ],
    },
  });

  const [record] = Object.values(state?.committedTasks ?? {});
  assert.equal(record?.taskTitle, 'Build slice');
  assert.match(record?.commitSha ?? '', /^legacy:/);
});

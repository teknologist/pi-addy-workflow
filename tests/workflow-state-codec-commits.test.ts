import test from 'node:test';
import assert from 'node:assert/strict';
import { workflowTaskCommitKey } from '../extensions/workflow-monitor/plan-task-lifecycle.ts';
import {
  backfillCommittedTasksFromStats,
  coerceCommittedTasks,
  isWorkflowTaskCommitRecord,
} from '../extensions/workflow-monitor/workflow-state-codec-commits.ts';

test('committed task codec accepts valid persisted task commit records', () => {
  const record = {
    plan: 'docs/plans/current.md',
    taskId: 'task-123',
    sliceIndex: 2,
    taskIndex: 1,
    taskTitle: 'Current task',
    commitSha: 'abc123',
    committedAt: '2026-05-22T12:00:00.000Z',
  };

  assert.equal(isWorkflowTaskCommitRecord(record), true);
  assert.deepEqual(coerceCommittedTasks({ valid: record }), { valid: record });
});

test('committed task codec skips invalid records inside persisted maps', () => {
  assert.equal(coerceCommittedTasks(undefined), undefined);
  assert.equal(coerceCommittedTasks([]), undefined);
  assert.deepEqual(
    coerceCommittedTasks({
      invalid: { plan: 'docs/plans/current.md', taskIndex: '1' },
      valid: {
        plan: 'docs/plans/current.md',
        taskIndex: 1,
        taskTitle: 'Current task',
        commitSha: 'abc123',
        committedAt: '2026-05-22T12:00:00.000Z',
      },
    }),
    {
      valid: {
        plan: 'docs/plans/current.md',
        taskIndex: 1,
        taskTitle: 'Current task',
        commitSha: 'abc123',
        committedAt: '2026-05-22T12:00:00.000Z',
      },
    },
  );
});

test('committed task codec backfills legacy commit evidence from task-commit stats', () => {
  const plan = 'docs/plans/legacy.md';
  const taskTitle = 'Persist old evidence';
  const key = workflowTaskCommitKey(plan, 1, taskTitle);

  const committedTasks = backfillCommittedTasksFromStats({
    history: [
      {
        endedReason: 'task-commit',
        tasks: {
          committed: {
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
  });

  assert.equal(committedTasks?.[key]?.committedAt, 'legacy-task-commit');
  assert.match(committedTasks?.[key]?.commitSha ?? '', /^legacy:/);
  assert.equal(Object.keys(committedTasks ?? {}).length, 1);
});

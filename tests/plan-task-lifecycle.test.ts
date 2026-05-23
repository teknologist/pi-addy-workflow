import test from 'node:test';
import assert from 'node:assert/strict';
import {
  planTaskFrontier,
  planTasksFromMarkdown,
  workflowTaskCommitKey,
} from '../extensions/workflow-monitor/plan-task-lifecycle.ts';

test('plan task lifecycle parses stable task id comments', () => {
  assert.deepEqual(
    planTasksFromMarkdown(
      [
        '## Task 1: Add widget',
        '<!-- addy-task-id: task-k7p4x9 -->',
        '',
        '- [ ] Implemented',
        '- [x] Verified',
        '- [ ] Reviewed',
      ].join('\n'),
    ),
    [
      {
        title: 'Add widget',
        taskId: 'task-k7p4x9',
        complete: false,
        missingStatuses: ['Implemented', 'Reviewed'],
      },
    ],
  );
});

test('plan task lifecycle uses stable task id for commit evidence', () => {
  const planPath = 'docs/plans/slice-01.md';
  const tasks = planTasksFromMarkdown(
    [
      '## Task 1: Renamed task title',
      '<!-- addy-task-id: task-k7p4x9 -->',
      '- [x] Implemented',
      '- [x] Verified',
      '- [x] Reviewed',
      '',
      '## Task 2: Next task',
      '<!-- addy-task-id: task-n8q2z4 -->',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  assert.deepEqual(
    planTaskFrontier({
      planPath,
      tasks,
      committedTasks: {
        [workflowTaskCommitKey(
          planPath,
          1,
          'Original task title',
          'task-k7p4x9',
        )]: {
          plan: planPath,
          taskId: 'task-k7p4x9',
          taskIndex: 1,
          taskTitle: 'Original task title',
          commitSha: 'abc1234',
          committedAt: '2026-05-22T00:00:00.000Z',
        },
      },
    }),
    {
      title: 'Next task',
      taskId: 'task-n8q2z4',
      complete: false,
      missingStatuses: ['Implemented', 'Verified', 'Reviewed'],
      taskIndex: 2,
      requiresCommit: false,
    },
  );
});

test('plan task lifecycle falls back to legacy commit evidence after task id is added', () => {
  const planPath = 'docs/plans/slice-01.md';
  const tasks = planTasksFromMarkdown(
    [
      '## Task 1: Add widget',
      '<!-- addy-task-id: task-k7p4x9 -->',
      '- [x] Implemented',
      '- [x] Verified',
      '- [x] Reviewed',
      '',
      '## Task 2: Next task',
      '<!-- addy-task-id: task-n8q2z4 -->',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  assert.deepEqual(
    planTaskFrontier({
      planPath,
      tasks,
      committedTasks: {
        [workflowTaskCommitKey(planPath, 1, 'Add widget')]: {
          plan: planPath,
          taskIndex: 1,
          taskTitle: 'Add widget',
          commitSha: 'legacy123',
          committedAt: '2026-05-22T00:00:00.000Z',
        },
      },
    }),
    {
      title: 'Next task',
      taskId: 'task-n8q2z4',
      complete: false,
      missingStatuses: ['Implemented', 'Verified', 'Reviewed'],
      taskIndex: 2,
      requiresCommit: false,
    },
  );
});

test('plan task lifecycle ignores duplicate stable task ids for commit evidence', () => {
  const planPath = 'docs/plans/slice-01.md';
  const tasks = planTasksFromMarkdown(
    [
      '## Task 1: First task',
      '<!-- addy-task-id: task-dupe -->',
      '- [x] Implemented',
      '- [x] Verified',
      '- [x] Reviewed',
      '',
      '## Task 2: Second task',
      '<!-- addy-task-id: task-dupe -->',
      '- [x] Implemented',
      '- [x] Verified',
      '- [x] Reviewed',
      '',
      '## Task 3: Third task',
      '<!-- addy-task-id: task-next -->',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  assert.equal(tasks[0].taskId, undefined);
  assert.equal(tasks[1].taskId, undefined);
  assert.deepEqual(
    planTaskFrontier({
      planPath,
      tasks,
      committedTasks: {
        [workflowTaskCommitKey(planPath, 1, 'First task')]: {
          plan: planPath,
          taskIndex: 1,
          taskTitle: 'First task',
          commitSha: 'legacy123',
          committedAt: '2026-05-22T00:00:00.000Z',
        },
        [workflowTaskCommitKey(planPath, 1, 'First task', 'task-dupe')]: {
          plan: planPath,
          taskId: 'task-dupe',
          taskIndex: 1,
          taskTitle: 'First task',
          commitSha: 'abc1234',
          committedAt: '2026-05-22T00:00:00.000Z',
        },
      },
    }),
    {
      title: 'Second task',
      complete: true,
      missingStatuses: [],
      taskIndex: 2,
      requiresCommit: true,
    },
  );
});

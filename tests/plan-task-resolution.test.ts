import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolvePlanTaskTarget,
  resolvedPlanTaskMatchesTarget,
} from '../extensions/workflow-monitor/plan-task-resolution.ts';
import type { PlanTask } from '../extensions/workflow-monitor/plan-task-lifecycle.ts';

const tasks: PlanTask[] = [
  { title: 'First task', taskId: 'task-a', complete: true },
  { title: 'Second task', taskId: 'task-b', complete: false },
];

test('plan task resolution prefers stable task id', () => {
  const resolved = resolvePlanTaskTarget(tasks, {
    taskId: 'task-b',
    taskIndex: 1,
    taskTitle: 'First task',
  });

  assert.equal(resolved?.task.title, 'Second task');
  assert.equal(resolved?.taskIndex, 2);
  assert.equal(
    resolvedPlanTaskMatchesTarget(resolved, { taskId: 'task-b' }),
    true,
  );
});

test('plan task resolution falls back to legacy index before title', () => {
  const resolved = resolvePlanTaskTarget(tasks, {
    taskIndex: 2,
    taskTitle: 'First task',
  });

  assert.equal(resolved?.task.title, 'Second task');
  assert.equal(resolved?.taskIndex, 2);
  assert.equal(
    resolvedPlanTaskMatchesTarget(resolved, {
      taskIndex: 2,
      taskTitle: 'First task',
    }),
    false,
  );
});

test('plan task resolution falls back to legacy title', () => {
  const resolved = resolvePlanTaskTarget(tasks, { taskTitle: 'First task' });

  assert.equal(resolved?.task.taskId, 'task-a');
  assert.equal(resolved?.taskIndex, 1);
  assert.equal(
    resolvedPlanTaskMatchesTarget(resolved, { taskTitle: 'First task' }),
    true,
  );
});

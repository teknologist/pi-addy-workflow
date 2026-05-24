import test from 'node:test';
import assert from 'node:assert/strict';
import { coerceWorkflowTaskProgress } from '../extensions/workflow-monitor/workflow-state-codec-tasks.ts';

test('task progress codec accepts valid persisted task progress fields', () => {
  assert.deepEqual(
    coerceWorkflowTaskProgress({
      currentTask: 'Build feature',
      currentTaskId: 'task-123',
      nextTask: 'Verify feature',
      nextTaskId: 'task-124',
      currentTaskIndex: 1,
      taskCount: 2,
      currentSliceIndex: 1,
      sliceCount: 3,
      currentTaskSummary: 'Build',
      nextTaskSummary: 'Verify',
    }),
    {
      currentTask: 'Build feature',
      currentTaskId: 'task-123',
      nextTask: 'Verify feature',
      nextTaskId: 'task-124',
      currentTaskIndex: 1,
      taskCount: 2,
      currentSliceIndex: 1,
      sliceCount: 3,
      currentTaskSummary: 'Build',
      nextTaskSummary: 'Verify',
    },
  );
});

test('task progress codec accepts omitted optional progress fields', () => {
  assert.deepEqual(coerceWorkflowTaskProgress({}), {
    currentTask: undefined,
    currentTaskId: undefined,
    nextTask: undefined,
    nextTaskId: undefined,
    currentTaskIndex: undefined,
    taskCount: undefined,
    currentSliceIndex: undefined,
    sliceCount: undefined,
    currentTaskSummary: undefined,
    nextTaskSummary: undefined,
  });
});

test('task progress codec rejects invalid task indexes and summaries', () => {
  assert.equal(
    coerceWorkflowTaskProgress({ currentTask: 42 as never }),
    undefined,
  );
  assert.equal(coerceWorkflowTaskProgress({ currentTaskIndex: 0 }), undefined);
  assert.equal(
    coerceWorkflowTaskProgress({ currentTaskIndex: 3, taskCount: 2 }),
    undefined,
  );
  assert.equal(
    coerceWorkflowTaskProgress({ currentSliceIndex: 4, sliceCount: 3 }),
    undefined,
  );
  assert.equal(
    coerceWorkflowTaskProgress({ nextTaskSummary: false as never }),
    undefined,
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { stateForNextSlicePlan } from '../extensions/workflow-monitor/workflow-plan-continuation.ts';
import type { WorkflowState } from '../extensions/workflow-monitor/workflow-transitions.ts';

const baseState: WorkflowState = {
  phases: {
    define: 'complete',
    plan: 'complete',
    build: 'complete',
    simplify: 'pending',
    verify: 'complete',
    review: 'complete',
    finish: 'pending',
  },
  warnings: [],
  activePlan: 'plans/index.md',
  currentTask: 'Current',
  currentTaskId: 'task-current',
  nextTask: 'Next',
  nextTaskId: 'task-next',
  currentTaskIndex: 2,
  taskCount: 4,
  currentTaskSummary: 'Current summary',
  nextTaskSummary: 'Next summary',
  autoReviewTask: 'Review target',
  autoReviewTaskId: 'review-task',
  autoReviewTaskIndex: 2,
};

test('plan continuation advances active plan and clears task context', () => {
  const state = stateForNextSlicePlan(baseState, 'plans/slice-02.md');

  assert.equal(state.activePlan, 'plans/slice-02.md');
  assert.equal(state.activeSuitePlan, 'plans/index.md');
  assert.equal(state.currentTask, undefined);
  assert.equal(state.currentTaskId, undefined);
  assert.equal(state.nextTask, undefined);
  assert.equal(state.nextTaskId, undefined);
  assert.equal(state.currentTaskIndex, undefined);
  assert.equal(state.taskCount, undefined);
  assert.equal(state.currentTaskSummary, undefined);
  assert.equal(state.nextTaskSummary, undefined);
});

test('plan continuation preserves review target by default', () => {
  const state = stateForNextSlicePlan(baseState, 'plans/slice-02.md');

  assert.equal(state.autoReviewTask, 'Review target');
  assert.equal(state.autoReviewTaskId, 'review-task');
  assert.equal(state.autoReviewTaskIndex, 2);
});

test('plan continuation can clear review target intentionally', () => {
  const state = stateForNextSlicePlan(baseState, 'plans/slice-02.md', {
    clearReviewTarget: true,
  });

  assert.equal(state.autoReviewTask, undefined);
  assert.equal(state.autoReviewTaskId, undefined);
  assert.equal(state.autoReviewTaskIndex, undefined);
});

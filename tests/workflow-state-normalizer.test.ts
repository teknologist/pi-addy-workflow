import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWorkflowState } from '../extensions/workflow-monitor/workflow-state-normalizer.ts';
import { createInitialWorkflowState } from '../extensions/workflow-monitor/workflow-transitions.ts';

test('state normalizer completes spec and plan after planning', () => {
  const state = normalizeWorkflowState({
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

test('state normalizer sanitizes invalid active plan artifacts', () => {
  const state = normalizeWorkflowState({
    ...createInitialWorkflowState(),
    activePlan: '/addy-build',
    activeSuitePlan: '/tmp/index.md',
  });

  assert.equal(state.activePlan, undefined);
  assert.equal(state.activeSuitePlan, '/tmp/index.md');
});

test('state normalizer preserves task fields only when task context exists', () => {
  const state = normalizeWorkflowState({
    ...createInitialWorkflowState(),
    currentTask: 'Build feature',
    currentTaskId: 'task-123',
    currentTaskIndex: 1,
    taskCount: 2,
    currentTaskSummary: 'Build',
  });

  assert.equal(state.currentTask, 'Build feature');
  assert.equal(state.currentTaskId, 'task-123');
  assert.equal(state.currentTaskIndex, 1);
  assert.equal(state.taskCount, 2);
  assert.equal(state.currentTaskSummary, 'Build');
});

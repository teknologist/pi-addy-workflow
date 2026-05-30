import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWorkflowState } from '../extensions/workflow-monitor/workflow-state-parser.ts';
import { WORKFLOW_STATE_ENTRY_TYPE } from '../extensions/workflow-monitor/workflow-state-entry-codec.ts';
import { createInitialWorkflowState } from '../extensions/workflow-monitor/workflow-transitions.ts';

test('state parser accepts object workflow state inputs', () => {
  const state = parseWorkflowState({
    ...createInitialWorkflowState(),
    current: 'build',
  });

  assert.equal(state.current, 'build');
});

test('state parser accepts string wrapper workflow state inputs', () => {
  const state = parseWorkflowState(
    JSON.stringify({
      type: WORKFLOW_STATE_ENTRY_TYPE,
      state: { ...createInitialWorkflowState(), current: 'verify' },
    }),
  );

  assert.equal(state.current, 'verify');
});

test('state parser normalizes parsed workflow state', () => {
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

test('state parser returns initial workflow state for malformed input', () => {
  assert.deepEqual(
    parseWorkflowState('not json'),
    createInitialWorkflowState(),
  );
  assert.deepEqual(parseWorkflowState(null), createInitialWorkflowState());
});

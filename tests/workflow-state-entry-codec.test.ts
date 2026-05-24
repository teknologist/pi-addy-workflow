import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WORKFLOW_STATE_ENTRY_TYPE,
  parsePersistedWorkflowState,
  serializeWorkflowState,
  workflowStateFromEntry,
} from '../extensions/workflow-monitor/workflow-state-entry-codec.ts';
import { createInitialWorkflowState } from '../extensions/workflow-monitor/workflow-transitions.ts';

test('entry codec serializes workflow state wrappers', () => {
  assert.deepEqual(
    JSON.parse(serializeWorkflowState(createInitialWorkflowState())),
    {
      type: WORKFLOW_STATE_ENTRY_TYPE,
      state: createInitialWorkflowState(),
    },
  );
});

test('entry codec parses persisted wrapper strings and normalizes state', () => {
  const state = parsePersistedWorkflowState(
    JSON.stringify({
      type: WORKFLOW_STATE_ENTRY_TYPE,
      state: {
        ...createInitialWorkflowState(),
        current: 'review',
        phases: {
          ...createInitialWorkflowState().phases,
          review: 'active',
        },
      },
    }),
  );

  assert.equal(state?.current, 'review');
  assert.equal(state?.phases.define, 'complete');
  assert.equal(state?.phases.plan, 'complete');
});

test('entry codec fails closed for malformed persisted state', () => {
  assert.equal(parsePersistedWorkflowState('not json'), undefined);
  assert.equal(
    parsePersistedWorkflowState({
      ...createInitialWorkflowState(),
      warnings: [1],
    }),
    undefined,
  );
});

test('entry codec decodes tuple and custom session entries', () => {
  const state = { ...createInitialWorkflowState(), current: 'build' as const };

  assert.equal(
    workflowStateFromEntry([WORKFLOW_STATE_ENTRY_TYPE, state])?.current,
    'build',
  );
  assert.equal(
    workflowStateFromEntry({
      type: 'custom',
      customType: WORKFLOW_STATE_ENTRY_TYPE,
      data: state,
    })?.current,
    'build',
  );
  assert.equal(workflowStateFromEntry(['other', state]), undefined);
});

test('entry codec fails closed for malformed runtime entries', () => {
  assert.equal(workflowStateFromEntry(null as never), undefined);
  assert.equal(workflowStateFromEntry(undefined as never), undefined);
});

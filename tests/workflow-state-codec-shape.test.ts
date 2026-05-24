import test from 'node:test';
import assert from 'node:assert/strict';
import {
  coerceWorkflowCurrent,
  hasWorkflowStateShape,
} from '../extensions/workflow-monitor/workflow-state-codec-shape.ts';
import { createInitialWorkflowState } from '../extensions/workflow-monitor/workflow-transitions.ts';

test('state shape codec detects persisted workflow state shape', () => {
  assert.equal(hasWorkflowStateShape(createInitialWorkflowState()), true);
  assert.equal(hasWorkflowStateShape({ phases: {} }), false);
  assert.equal(hasWorkflowStateShape(null), false);
});

test('state shape codec coerces current phase and legacy ship phase', () => {
  assert.equal(coerceWorkflowCurrent(undefined), undefined);
  assert.equal(coerceWorkflowCurrent('build'), 'build');
  assert.equal(coerceWorkflowCurrent('ship'), 'finish');
  assert.equal(coerceWorkflowCurrent('unknown'), undefined);
});

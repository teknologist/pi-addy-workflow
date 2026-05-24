import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readWorkflowMemoryState,
  writeWorkflowMemoryState,
  writeWorkflowMemoryStates,
} from '../extensions/workflow-monitor/workflow-state-memory-store.ts';
import { createInitialWorkflowState } from '../extensions/workflow-monitor/workflow-transitions.ts';

test('workflow state memory store reads and writes one state key', () => {
  const state = { ...createInitialWorkflowState(), current: 'build' as const };

  writeWorkflowMemoryState('memory-single-key', state);

  assert.equal(readWorkflowMemoryState('memory-single-key')?.current, 'build');
});

test('workflow state memory store writes session and project keys together', () => {
  const state = { ...createInitialWorkflowState(), current: 'review' as const };

  writeWorkflowMemoryStates(
    ['memory-session-key', 'memory-project-key'],
    state,
  );

  assert.equal(
    readWorkflowMemoryState('memory-session-key')?.current,
    'review',
  );
  assert.equal(
    readWorkflowMemoryState('memory-project-key')?.current,
    'review',
  );
});

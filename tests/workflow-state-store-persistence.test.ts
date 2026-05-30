import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readStoredWorkflowState,
  writeStoredWorkflowState,
} from '../extensions/workflow-monitor/workflow-state-store-persistence.ts';
import { WORKFLOW_STATE_ENTRY_TYPE } from '../extensions/workflow-monitor/workflow-state-codec.ts';
import { workflowStatePath } from '../extensions/workflow-monitor/workflow-state-store-scope.ts';
import { createInitialWorkflowState } from '../extensions/workflow-monitor/workflow-transitions.ts';

test('workflow state persistence writes and reads wrapped state files', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'pi-addy-store-persist-'));
  try {
    const state = {
      ...createInitialWorkflowState(),
      current: 'verify' as const,
    };
    writeStoredWorkflowState('state-key', state, { cwd });

    assert.deepEqual(
      JSON.parse(readFileSync(workflowStatePath('state-key', { cwd }), 'utf8')),
      {
        type: WORKFLOW_STATE_ENTRY_TYPE,
        state,
      },
    );
    assert.equal(
      readStoredWorkflowState('state-key', { cwd })?.current,
      'verify',
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('workflow state persistence fails closed for missing or invalid files', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'pi-addy-store-invalid-'));
  try {
    assert.equal(readStoredWorkflowState('missing', { cwd }), undefined);
    mkdirSync(join(cwd, '.pi', 'addy-workflow', 'state'), { recursive: true });
    writeFileSync(workflowStatePath('bad', { cwd }), 'not json', 'utf8');
    assert.equal(readStoredWorkflowState('bad', { cwd }), undefined);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import {
  projectWorkflowStateKey,
  workflowStateDir,
  workflowStateKey,
  workflowStatePath,
} from '../extensions/workflow-monitor/workflow-state-store-scope.ts';

test('workflow state scope creates stable explicit session keys', () => {
  assert.equal(
    workflowStateKey({ cwd: '/project-a', sessionId: 'session-a' }),
    workflowStateKey({ cwd: '/project-b', sessionId: 'session-a' }),
  );
  assert.notEqual(
    workflowStateKey({ cwd: '/project-a', sessionId: 'session-a' }),
    workflowStateKey({ cwd: '/project-a', sessionId: 'session-b' }),
  );
});

test('workflow state scope creates project-specific fallback keys', () => {
  assert.equal(
    projectWorkflowStateKey({ cwd: '/project-a', sessionId: 'session-a' }),
    projectWorkflowStateKey({ cwd: '/project-a', sessionId: 'session-b' }),
  );
  assert.notEqual(
    projectWorkflowStateKey({ cwd: '/project-a' }),
    projectWorkflowStateKey({ cwd: '/project-b' }),
  );
});

test('workflow state scope resolves project-local state paths by default', () => {
  const previousStateDir = process.env.PI_ADDY_WORKFLOW_STATE_DIR;
  delete process.env.PI_ADDY_WORKFLOW_STATE_DIR;
  try {
    assert.equal(
      workflowStateDir({ cwd: '/project-a' }),
      join('/project-a', '.pi', 'addy-workflow', 'state'),
    );
    assert.equal(
      workflowStatePath('abc123', { cwd: '/project-a' }),
      join('/project-a', '.pi', 'addy-workflow', 'state', 'abc123.json'),
    );
  } finally {
    if (previousStateDir === undefined)
      delete process.env.PI_ADDY_WORKFLOW_STATE_DIR;
    else process.env.PI_ADDY_WORKFLOW_STATE_DIR = previousStateDir;
  }
});

test('workflow state scope honors explicit state directory override', () => {
  const previousStateDir = process.env.PI_ADDY_WORKFLOW_STATE_DIR;
  process.env.PI_ADDY_WORKFLOW_STATE_DIR = '/tmp/pi-addy-state';
  try {
    assert.equal(workflowStateDir({ cwd: '/project-a' }), '/tmp/pi-addy-state');
    assert.equal(
      workflowStatePath('abc123', { cwd: '/project-a' }),
      join('/tmp/pi-addy-state', 'abc123.json'),
    );
  } finally {
    if (previousStateDir === undefined)
      delete process.env.PI_ADDY_WORKFLOW_STATE_DIR;
    else process.env.PI_ADDY_WORKFLOW_STATE_DIR = previousStateDir;
  }
});

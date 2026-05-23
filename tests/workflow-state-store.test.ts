import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInitialWorkflowState } from '../extensions/workflow-monitor/workflow-transitions.ts';
import { workflowStateStore } from '../extensions/workflow-monitor/workflow-state-store.ts';

test('workflow state store restores state from appended session entries', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'pi-addy-store-entries-'));
  const entries: [string, unknown][] = [];
  try {
    workflowStateStore.set(
      { cwd, sessionId: 'first-session' },
      {
        ...createInitialWorkflowState(),
        current: 'verify',
        activePlan: 'plans/slice-01.md',
      },
      (type, data) => entries.push([type, data]),
    );

    assert.equal(
      workflowStateStore.get({
        cwd,
        sessionId: 'second-session',
        sessionManager: { getBranch: () => entries },
      }).current,
      'verify',
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('workflow state store falls back to project state across sessions', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'pi-addy-store-project-'));
  try {
    workflowStateStore.set(
      { cwd, sessionId: 'source-session' },
      {
        ...createInitialWorkflowState(),
        current: 'build',
        activePlan: 'plans/slice-02.md',
      },
    );

    const restored = workflowStateStore.get({
      cwd,
      sessionId: 'fresh-session',
    });
    assert.equal(restored.current, 'build');
    assert.equal(restored.activePlan, 'plans/slice-02.md');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('workflow state store persists under project .pi by default', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'pi-addy-store-path-'));
  const previousStateDir = process.env.PI_ADDY_WORKFLOW_STATE_DIR;
  delete process.env.PI_ADDY_WORKFLOW_STATE_DIR;
  try {
    workflowStateStore.set(
      { cwd, sessionId: 'path-session' },
      {
        ...createInitialWorkflowState(),
        current: 'review',
      },
    );

    assert.ok(
      readdirSync(join(cwd, '.pi', 'addy-workflow', 'state')).some((file) =>
        file.endsWith('.json'),
      ),
    );
  } finally {
    if (previousStateDir === undefined)
      delete process.env.PI_ADDY_WORKFLOW_STATE_DIR;
    else process.env.PI_ADDY_WORKFLOW_STATE_DIR = previousStateDir;
    rmSync(cwd, { recursive: true, force: true });
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WORKFLOW_STATE_ENTRY_TYPE } from '../extensions/workflow-monitor/workflow-state-codec.ts';
import { readWorkflowMemoryState } from '../extensions/workflow-monitor/workflow-state-memory-store.ts';
import {
  commitWorkflowState,
  type WorkflowStateCommitContext,
} from '../extensions/workflow-monitor/workflow-state-store-commit.ts';
import { readStoredWorkflowState } from '../extensions/workflow-monitor/workflow-state-store-persistence.ts';
import {
  projectWorkflowStateKey,
  workflowStateKey,
} from '../extensions/workflow-monitor/workflow-state-store-scope.ts';
import { createInitialWorkflowState } from '../extensions/workflow-monitor/workflow-transitions.ts';

test('workflow state store commit writes ctx, memory, persistence, and append entry', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'pi-addy-store-commit-'));
  const ctx: WorkflowStateCommitContext = { cwd, sessionId: 'commit-session' };
  const entries: Array<[string, unknown]> = [];
  try {
    const state = {
      ...createInitialWorkflowState(),
      current: 'verify' as const,
    };

    commitWorkflowState(ctx, state, (type, data) => entries.push([type, data]));

    const key = workflowStateKey(ctx);
    const projectKey = projectWorkflowStateKey(ctx);
    assert.equal(ctx.state?.current, 'verify');
    assert.equal(readWorkflowMemoryState(key)?.current, 'verify');
    assert.equal(readWorkflowMemoryState(projectKey)?.current, 'verify');
    assert.equal(readStoredWorkflowState(key, ctx)?.current, 'verify');
    assert.equal(readStoredWorkflowState(projectKey, ctx)?.current, 'verify');
    assert.deepEqual(entries, [[WORKFLOW_STATE_ENTRY_TYPE, state]]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

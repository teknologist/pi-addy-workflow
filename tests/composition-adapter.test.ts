import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  baseCwd,
  freshContextConfig,
  getWorkflowStateFromContext,
  maxReviewFixLoops,
  setWorkflowStateFromContext,
  shouldFreshContextBeforeEveryStep,
} from '../extensions/workflow-monitor/composition-adapter.ts';
import { createInitialWorkflowState } from '../extensions/workflow-monitor/workflow-transitions.ts';

function withEnv(
  overrides: Record<string, string | undefined>,
  run: () => void,
) {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('composition adapter reads base cwd from host context', () => {
  assert.equal(baseCwd({ cwd: '/tmp/project' }), '/tmp/project');
  assert.equal(baseCwd({}), undefined);
});

test('composition adapter exposes workflow config decisions through named seams', () => {
  withEnv(
    {
      PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP: 'false',
      PI_ADDY_AUTO_FRESH_CONTEXT_BETWEEN_TASKS: 'true',
      PI_ADDY_AUTO_FRESH_CONTEXT_BEFORE_REVIEW: 'true',
      PI_ADDY_AUTO_REVIEW_MAX_FIX_LOOPS: '7',
    },
    () => {
      assert.equal(shouldFreshContextBeforeEveryStep({}), false);
      assert.deepEqual(freshContextConfig({}), {
        beforeEveryStep: false,
        betweenTasks: true,
        beforeReview: true,
      });
      assert.equal(maxReviewFixLoops({}), 7);
    },
  );
});

test('composition adapter reads and writes workflow state through named seams', () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'addy-composition-adapter-'));
  withEnv({ PI_ADDY_WORKFLOW_STATE_DIR: stateDir }, () => {
    const ctx = { sessionId: 'composition-adapter-test' };
    const state = {
      ...createInitialWorkflowState(),
      autoMode: true,
      currentTask: 'Adapter task',
    };

    setWorkflowStateFromContext(ctx, state);

    assert.equal(getWorkflowStateFromContext(ctx).currentTask, 'Adapter task');
    assert.equal(getWorkflowStateFromContext(ctx).autoMode, true);
  });
  rmSync(stateDir, { recursive: true, force: true });
});

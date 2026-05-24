import test from 'node:test';
import assert from 'node:assert/strict';
import {
  coerceWorkflowMetadata,
  sanitizePlanArtifact,
  sanitizeWorkflowArtifacts,
} from '../extensions/workflow-monitor/workflow-state-codec-metadata.ts';
import { createInitialWorkflowState } from '../extensions/workflow-monitor/workflow-transitions.ts';

test('metadata codec sanitizes slash-like command artifacts but keeps markdown paths', () => {
  assert.equal(sanitizePlanArtifact('/addy-verify'), undefined);
  assert.equal(sanitizePlanArtifact('/tmp/plan.md'), '/tmp/plan.md');
  assert.deepEqual(
    sanitizeWorkflowArtifacts({
      ...createInitialWorkflowState(),
      activePlan: '/addy-auto',
      activeSuitePlan: 'docs/plans/index.md',
    }),
    {
      ...createInitialWorkflowState(),
      activePlan: undefined,
      activeSuitePlan: 'docs/plans/index.md',
    },
  );
});

test('metadata codec accepts valid persisted metadata fields', () => {
  assert.deepEqual(
    coerceWorkflowMetadata({
      warnings: ['review started before verify.'],
      activeSpec: 'docs/specs/spec.md',
      activePlan: 'docs/plans/plan.md',
      activeSuitePlan: 'docs/plans/index.md',
      lastTrigger: '/addy-review',
      lastArtifact: 'docs/plans/plan.md',
      testStatus: 'passed',
    }),
    {
      warnings: ['review started before verify.'],
      activeSpec: 'docs/specs/spec.md',
      activePlan: 'docs/plans/plan.md',
      activeSuitePlan: 'docs/plans/index.md',
      lastTrigger: '/addy-review',
      lastArtifact: 'docs/plans/plan.md',
      testStatus: 'passed',
    },
  );
});

test('metadata codec rejects invalid persisted metadata fields', () => {
  assert.equal(
    coerceWorkflowMetadata({ warnings: 'nope' as never }),
    undefined,
  );
  assert.equal(coerceWorkflowMetadata({ warnings: [1] as never }), undefined);
  assert.equal(
    coerceWorkflowMetadata({ warnings: [], activePlan: false as never }),
    undefined,
  );
  assert.equal(
    coerceWorkflowMetadata({ warnings: [], testStatus: 'broken' as never }),
    undefined,
  );
});

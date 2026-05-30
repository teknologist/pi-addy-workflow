import test from 'node:test';
import assert from 'node:assert/strict';
import { coerceWorkflowReviewControl } from '../extensions/workflow-monitor/workflow-state-codec-review.ts';

test('review control codec accepts valid persisted review fields', () => {
  assert.deepEqual(
    coerceWorkflowReviewControl({
      autoReviewFixKey: 'review:key',
      autoReviewFixCount: 2,
      autoReviewFindingFingerprint: 'fingerprint',
      autoReviewFixNeedsReview: true,
      autoReviewTask: 'Review task',
      autoReviewTaskId: 'task-123',
      autoReviewTaskIndex: 1,
      reviewStatsKey: 'stats:key',
      reviewStatsAgent: 'addy-reviewer',
    }),
    {
      autoReviewFixKey: 'review:key',
      autoReviewFixCount: 2,
      autoReviewFindingFingerprint: 'fingerprint',
      autoReviewFixNeedsReview: true,
      autoReviewTask: 'Review task',
      autoReviewTaskId: 'task-123',
      autoReviewTaskIndex: 1,
      reviewStatsKey: 'stats:key',
      reviewStatsAgent: 'addy-reviewer',
    },
  );
});

test('review control codec accepts omitted optional review fields', () => {
  assert.deepEqual(coerceWorkflowReviewControl({}), {
    autoReviewFixKey: undefined,
    autoReviewFixCount: undefined,
    autoReviewFindingFingerprint: undefined,
    autoReviewFixNeedsReview: undefined,
    autoReviewTask: undefined,
    autoReviewTaskId: undefined,
    autoReviewTaskIndex: undefined,
    reviewStatsKey: undefined,
    reviewStatsAgent: undefined,
  });
});

test('review control codec rejects invalid persisted review fields', () => {
  assert.equal(
    coerceWorkflowReviewControl({ autoReviewFixKey: 42 as never }),
    undefined,
  );
  assert.equal(
    coerceWorkflowReviewControl({ autoReviewFixCount: -1 }),
    undefined,
  );
  assert.equal(
    coerceWorkflowReviewControl({ autoReviewFixNeedsReview: 'yes' as never }),
    undefined,
  );
  assert.equal(
    coerceWorkflowReviewControl({ autoReviewTaskIndex: 0 }),
    undefined,
  );
  assert.equal(
    coerceWorkflowReviewControl({ reviewStatsAgent: false as never }),
    undefined,
  );
});

import type { WorkflowState } from './workflow-core.ts';
import {
  isNonNegativeSafeInteger,
  isOptionalBoolean,
  isOptionalString,
  isPositiveSafeInteger,
} from './workflow-state-codec-primitives.ts';

type WorkflowReviewControlFields = Pick<
  WorkflowState,
  | 'autoReviewFixKey'
  | 'autoReviewFixCount'
  | 'autoReviewFindingFingerprint'
  | 'autoReviewFixNeedsReview'
  | 'autoReviewTask'
  | 'autoReviewTaskId'
  | 'autoReviewTaskIndex'
  | 'reviewStatsKey'
  | 'reviewStatsAgent'
>;

export function coerceWorkflowReviewControl(
  candidate: Partial<WorkflowReviewControlFields>,
): WorkflowReviewControlFields | undefined {
  if (!isOptionalString(candidate.autoReviewFixKey)) return undefined;
  if (
    candidate.autoReviewFixCount !== undefined &&
    !isNonNegativeSafeInteger(candidate.autoReviewFixCount)
  )
    return undefined;
  if (!isOptionalString(candidate.autoReviewFindingFingerprint))
    return undefined;
  if (!isOptionalBoolean(candidate.autoReviewFixNeedsReview)) return undefined;
  if (!isOptionalString(candidate.autoReviewTask)) return undefined;
  if (!isOptionalString(candidate.autoReviewTaskId)) return undefined;
  if (
    candidate.autoReviewTaskIndex !== undefined &&
    !isPositiveSafeInteger(candidate.autoReviewTaskIndex)
  )
    return undefined;
  if (!isOptionalString(candidate.reviewStatsKey)) return undefined;
  if (!isOptionalString(candidate.reviewStatsAgent)) return undefined;

  return {
    autoReviewFixKey: candidate.autoReviewFixKey,
    autoReviewFixCount: candidate.autoReviewFixCount,
    autoReviewFindingFingerprint: candidate.autoReviewFindingFingerprint,
    autoReviewFixNeedsReview: candidate.autoReviewFixNeedsReview,
    autoReviewTask: candidate.autoReviewTask,
    autoReviewTaskId: candidate.autoReviewTaskId,
    autoReviewTaskIndex: candidate.autoReviewTaskIndex,
    reviewStatsKey: candidate.reviewStatsKey,
    reviewStatsAgent: candidate.reviewStatsAgent,
  };
}

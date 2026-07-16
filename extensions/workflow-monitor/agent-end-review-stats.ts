import { reviewIssueStatsFromText } from './review-findings.ts';
import { recordWorkflowReviewIssues } from './workflow-stats.ts';
import type { WorkflowState } from './workflow-transitions.ts';

type ReviewAgentEvent = {
  agentName?: string;
  agent?: string;
};

export function stateWithAgentEndReviewIssues(
  state: WorkflowState,
  event: ReviewAgentEvent,
  reviewText: string,
): WorkflowState {
  if (state.executionSource === 'ticket') return state;
  const reviewAgent = event.agentName ?? event.agent;
  const shouldRecordReviewIssues = Boolean(
    state.reviewStatsKey &&
    (!state.reviewStatsAgent || reviewAgent === state.reviewStatsAgent),
  );
  return shouldRecordReviewIssues
    ? recordWorkflowReviewIssues(state, reviewIssueStatsFromText(reviewText))
    : state;
}

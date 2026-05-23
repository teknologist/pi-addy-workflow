import type { WorkflowState } from './workflow-transitions.ts';

export const REVIEW_CONTROL_FIELDS = [
  'autoReviewFixKey',
  'autoReviewFixCount',
  'autoReviewFindingFingerprint',
  'autoReviewFixNeedsReview',
  'autoReviewTask',
  'autoReviewTaskId',
  'autoReviewTaskIndex',
  'reviewStatsKey',
  'reviewStatsAgent',
] as const satisfies readonly (keyof WorkflowState)[];

export function clearReviewControlUpdates(): Partial<WorkflowState> {
  return Object.fromEntries(
    REVIEW_CONTROL_FIELDS.map((field) => [field, undefined]),
  ) as Partial<WorkflowState>;
}

export function clearReviewControl(state: WorkflowState): WorkflowState {
  return { ...state, ...clearReviewControlUpdates() };
}

export function reviewFixKey(state: WorkflowState): string {
  const taskIndex = state.autoReviewTaskIndex ?? state.currentTaskIndex ?? '';
  const taskId = state.autoReviewTaskId ?? state.currentTaskId ?? '';
  if (taskId) return [state.activePlan ?? '', 'task-id', taskId].join('\u001f');
  return legacyReviewFixKey(state);
}

export function legacyReviewFixKey(state: WorkflowState): string {
  const taskIndex = state.autoReviewTaskIndex ?? state.currentTaskIndex ?? '';
  const taskTitle =
    state.autoReviewTask && state.autoReviewTask !== 'none'
      ? state.autoReviewTask
      : (state.currentTask ?? '');
  return [state.activePlan ?? '', taskIndex, taskTitle].join('\u001f');
}

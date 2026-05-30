import type { WorkflowState } from './workflow-transitions.ts';

export function stateForNextSlicePlan(
  state: WorkflowState,
  nextSlicePlan: string,
  options: { clearReviewTarget?: boolean } = {},
): WorkflowState {
  return {
    ...state,
    activePlan: nextSlicePlan,
    activeSuitePlan: state.activeSuitePlan ?? state.activePlan,
    currentTask: undefined,
    currentTaskId: undefined,
    nextTask: undefined,
    nextTaskId: undefined,
    currentTaskIndex: undefined,
    taskCount: undefined,
    currentTaskSummary: undefined,
    nextTaskSummary: undefined,
    ...(options.clearReviewTarget
      ? {
          autoReviewTask: undefined,
          autoReviewTaskId: undefined,
          autoReviewTaskIndex: undefined,
        }
      : {}),
  };
}

import type { WorkflowState } from './workflow-transitions.ts';
import { workflowTaskIdentityKey } from './workflow-task-identity.ts';

export {
  clearReviewControl,
  clearReviewControlUpdates,
  REVIEW_CONTROL_FIELDS,
} from './workflow-state-control.ts';

export function reviewFixKey(state: WorkflowState): string {
  const taskIndex = state.autoReviewTaskIndex ?? state.currentTaskIndex ?? '';
  const taskId = state.autoReviewTaskId ?? state.currentTaskId ?? '';
  if (taskId)
    return workflowTaskIdentityKey({ plan: state.activePlan, taskId });
  return legacyReviewFixKey(state);
}

export function legacyReviewFixKey(state: WorkflowState): string {
  const taskIndex = state.autoReviewTaskIndex ?? state.currentTaskIndex ?? '';
  const taskTitle =
    state.autoReviewTask && state.autoReviewTask !== 'none'
      ? state.autoReviewTask
      : (state.currentTask ?? '');
  return workflowTaskIdentityKey({
    plan: state.activePlan,
    taskIndex: taskIndex || undefined,
    taskTitle,
  });
}

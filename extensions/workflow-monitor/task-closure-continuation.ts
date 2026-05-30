import { planPendingFreshDispatch } from './command-dispatch.ts';
import { commandFromPrompt } from './command-router.ts';
import { stateForNextSlicePlan } from './workflow-plan-continuation.ts';
import type { WorkflowState } from './workflow-transitions.ts';

export type TaskClosureContinuationPlan =
  | { kind: 'dispatch-next'; state: WorkflowState }
  | { kind: 'stop'; state: WorkflowState }
  | {
      kind: 'pending-fresh';
      state: WorkflowState;
      pendingState: WorkflowState;
      useCurrentSession: boolean;
    };

export function planTaskClosureContinuation(input: {
  stateAfterCommit: WorkflowState;
  nextSlicePlan?: string;
  nextAction?(state: WorkflowState): {
    prompt?: string;
    expandedPrompt?: string;
  };
  freshContextBetweenTasks: boolean;
  disableFreshSession?: boolean;
}): TaskClosureContinuationPlan {
  const continuationState = input.nextSlicePlan
    ? stateForNextSlicePlan(input.stateAfterCommit, input.nextSlicePlan, {
        clearReviewTarget: true,
      })
    : input.stateAfterCommit;
  const nextAction = input.nextAction?.(continuationState);
  const nextActionPrompt = nextAction?.prompt;

  if (commandFromPrompt(nextActionPrompt) === '/addy-finish') {
    return { kind: 'dispatch-next', state: continuationState };
  }

  if (input.freshContextBetweenTasks) {
    if (!nextActionPrompt) return { kind: 'stop', state: continuationState };

    const pendingFreshSourceState = {
      ...continuationState,
      autoReviewTask: undefined,
      autoReviewTaskId: undefined,
      autoReviewTaskIndex: undefined,
    };
    const pendingFreshPlan = planPendingFreshDispatch({
      prompt: nextActionPrompt,
      reason: 'between-tasks',
      state: pendingFreshSourceState,
      expandedPrompt: nextAction.expandedPrompt ?? nextActionPrompt,
    });
    return {
      kind: 'pending-fresh',
      state: continuationState,
      pendingState: pendingFreshPlan.state,
      useCurrentSession: Boolean(input.disableFreshSession),
    };
  }

  return { kind: 'dispatch-next', state: continuationState };
}

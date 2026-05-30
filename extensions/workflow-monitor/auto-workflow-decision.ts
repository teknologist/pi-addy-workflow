import { autoRetryKey } from './auto-control.ts';
import {
  autoPauseWarning,
  autoRecoveryPrompt,
  stateWithCompletedLifecyclePhasesFromPlan,
  type WorkflowAction,
} from './auto-lifecycle.ts';
import {
  commandFromPrompt,
  phaseFromWorkflowPrompt,
} from './command-router.ts';
import type { WorkflowStatsTarget } from './workflow-stats.ts';
import type { WorkflowState } from './workflow-transitions.ts';

export type AutoWorkflowDecision =
  | { kind: 'no-active-plan'; message: string }
  | { kind: 'task-commit'; target: WorkflowStatsTarget }
  | { kind: 'pause'; state: WorkflowState; message: string }
  | {
      kind: 'dispatch-prompt';
      prompt: string;
      state: WorkflowState;
      updates: Partial<WorkflowState>;
      statsTarget?: WorkflowStatsTarget;
      deliveryPrompt?: string;
    };

export function planAutoWorkflowDecision(input: {
  action: WorkflowAction;
  actionPendingCommitTarget?: WorkflowStatsTarget;
  allowSamePhase: boolean;
  autoSamePhaseMaxRetries: number;
  autoTaskCommitPrompt: string;
  pendingCommitTarget?: WorkflowStatsTarget;
  state: WorkflowState;
}): AutoWorkflowDecision {
  const prompt = input.action?.prompt;
  if (!prompt)
    return {
      kind: 'no-active-plan',
      message: 'Addy auto is active, but no active plan is available.',
    };

  if (input.actionPendingCommitTarget)
    return { kind: 'task-commit', target: input.actionPendingCommitTarget };

  if (
    input.pendingCommitTarget &&
    commandFromPrompt(input.state.autoLastPrompt) !== input.autoTaskCommitPrompt
  )
    return { kind: 'task-commit', target: input.pendingCommitTarget };

  const lifecycleSyncedState = stateWithCompletedLifecyclePhasesFromPlan(
    input.state,
    input.action,
  );
  const phase = phaseFromWorkflowPrompt(prompt);
  const retryKey = autoRetryKey(lifecycleSyncedState, prompt);
  const isSameIncompletePhase = phase && phase === lifecycleSyncedState.current;
  const retryCount =
    lifecycleSyncedState.autoRetryKey === retryKey
      ? (lifecycleSyncedState.autoRetryCount ?? 0)
      : 0;

  if (
    !input.allowSamePhase &&
    isSameIncompletePhase &&
    retryCount >= input.autoSamePhaseMaxRetries
  ) {
    const state = {
      ...lifecycleSyncedState,
      autoPausedReason: 'same-phase-retry-limit' as const,
    };
    return {
      kind: 'pause',
      state,
      message: autoPauseWarning(prompt, input.action),
    };
  }

  const deliveryPrompt =
    !input.allowSamePhase && isSameIncompletePhase && retryCount >= 1
      ? autoRecoveryPrompt(prompt, input.action, retryCount)
      : undefined;
  const reviewTask =
    phase === 'review'
      ? (input.action?.taskTitle ?? lifecycleSyncedState.currentTask)
      : undefined;
  const finishTask =
    phase === 'finish' ? lifecycleSyncedState.autoReviewTask : undefined;
  const reviewTaskId =
    phase === 'review'
      ? (input.action?.taskId ?? lifecycleSyncedState.currentTaskId)
      : undefined;
  const finishTaskId =
    phase === 'finish' ? lifecycleSyncedState.autoReviewTaskId : undefined;
  const taskTitle = reviewTask ?? finishTask;
  const taskId = reviewTaskId ?? finishTaskId;
  const taskIndex =
    phase === 'review'
      ? lifecycleSyncedState.currentTaskIndex
      : phase === 'finish'
        ? lifecycleSyncedState.autoReviewTaskIndex
        : undefined;

  return {
    kind: 'dispatch-prompt',
    prompt,
    state: lifecycleSyncedState,
    updates: {
      autoRetryKey: retryKey,
      autoRetryCount: isSameIncompletePhase ? retryCount + 1 : 0,
      autoReviewTask: taskTitle,
      autoReviewTaskId: taskId,
      autoReviewTaskIndex: taskIndex,
    },
    statsTarget: taskTitle ? { taskId, taskIndex, taskTitle } : undefined,
    deliveryPrompt,
  };
}

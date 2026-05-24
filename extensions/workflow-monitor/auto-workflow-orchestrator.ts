import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import {
  autoPauseWarning,
  autoRecoveryPrompt,
  completedPlanAutoContinuation,
  latestCompletedActiveStatsTarget,
  planTaskIsComplete,
  reviewedTaskWasCompleted,
  stateWithCompletedLifecyclePhasesFromPlan,
  type WorkflowAction,
} from './auto-lifecycle.ts';
import { autoRetryKey } from './auto-control.ts';
import {
  commandFromPrompt,
  phaseFromWorkflowPrompt,
} from './command-router.ts';
import { reviewTextHasActionableFindings } from './review-findings.ts';
import type { FreshContinuationDispatchOptions } from './fresh-continuation.ts';
import type { AppendEntry } from './workflow-state-store.ts';
import type { WorkflowStatsTarget } from './workflow-stats.ts';
import type { WorkflowState } from './workflow-transitions.ts';

type AutoPromptDispatcher = {
  dispatchAutoPromptFreshAware(
    pi: ExtensionAPI,
    ctx: unknown,
    prompt: string,
    state: WorkflowState,
    updates?: Partial<WorkflowState>,
    statsTarget?: WorkflowStatsTarget,
    options?: FreshContinuationDispatchOptions,
    deliveryPrompt?: string,
  ): Promise<void>;
};

type TaskCommitCoordinator = {
  actionCommitTarget(
    state: WorkflowState,
    action: WorkflowAction,
  ): WorkflowStatsTarget | undefined;
  dispatchTaskCommitPrompt(
    pi: ExtensionAPI,
    ctx: unknown,
    state: WorkflowState,
    target: WorkflowStatsTarget,
    options?: FreshContinuationDispatchOptions,
  ): Promise<void>;
  withPlanTaskId(
    target: WorkflowStatsTarget,
    baseCwd?: string,
  ): WorkflowStatsTarget | undefined;
};

type AutoWorkflowOrchestratorDeps = {
  appendEntry(pi: ExtensionAPI): AppendEntry;
  autoPromptDispatcher: AutoPromptDispatcher;
  autoSamePhaseMaxRetries: number;
  autoTaskCommitPrompt: string;
  baseCwd(ctx: unknown): string | undefined;
  getState(ctx: unknown): WorkflowState;
  nextActionForState(state: WorkflowState, baseCwd?: string): WorkflowAction;
  notify(ctx: unknown, message: string, level: string): void;
  setState(ctx: unknown, state: WorkflowState, appendEntry?: AppendEntry): void;
  taskCommitCoordinator: TaskCommitCoordinator;
};

export function createAutoWorkflowOrchestrator(
  deps: AutoWorkflowOrchestratorDeps,
) {
  async function dispatchAutoPromptFreshAware(
    pi: ExtensionAPI,
    ctx: unknown,
    prompt: string,
    state: WorkflowState,
    updates: Partial<WorkflowState> = {},
    statsTarget?: WorkflowStatsTarget,
    options: FreshContinuationDispatchOptions = {},
    deliveryPrompt?: string,
  ): Promise<void> {
    await deps.autoPromptDispatcher.dispatchAutoPromptFreshAware(
      pi,
      ctx,
      prompt,
      state,
      updates,
      statsTarget,
      options,
      deliveryPrompt,
    );
  }

  async function maybeDispatchTaskCommit(
    pi: ExtensionAPI,
    ctx: unknown,
    reviewText: string,
    previousState: WorkflowState,
    state: WorkflowState,
    action: WorkflowAction,
    options: FreshContinuationDispatchOptions = {},
  ): Promise<boolean> {
    if (commandFromPrompt(previousState.autoLastPrompt) !== '/addy-review')
      return false;
    if (!reviewText.trim() || reviewTextHasActionableFindings(reviewText))
      return false;
    const nextCommand = commandFromPrompt(action?.prompt);

    const reviewedTask =
      previousState.autoReviewTask && previousState.autoReviewTask !== 'none'
        ? previousState.autoReviewTask
        : previousState.currentTask;
    const reviewedTaskId =
      previousState.autoReviewTaskId ?? previousState.currentTaskId;
    const planMovedPastReviewTarget = Boolean(
      reviewedTask &&
      reviewedTask !== 'none' &&
      action?.taskTitle &&
      action.taskTitle !== reviewedTask,
    );
    const reviewedTaskIsComplete = planTaskIsComplete(
      previousState.activePlan,
      deps.baseCwd(ctx),
      {
        taskId: reviewedTaskId,
        taskIndex:
          previousState.autoReviewTaskIndex ?? previousState.currentTaskIndex,
        taskTitle: reviewedTask,
      },
    );
    if (nextCommand === '/addy-review' && !reviewedTaskIsComplete) return false;
    if (
      !planMovedPastReviewTarget &&
      !reviewedTaskWasCompleted(previousState, state) &&
      !reviewedTaskIsComplete
    )
      return false;

    const commitTarget = deps.taskCommitCoordinator.withPlanTaskId(
      {
        plan: previousState.activePlan,
        taskId: reviewedTaskId,
        sliceIndex: previousState.currentSliceIndex,
        taskIndex:
          previousState.autoReviewTaskIndex ?? previousState.currentTaskIndex,
        taskTitle: reviewedTask,
      },
      deps.baseCwd(ctx),
    );
    if (!commitTarget) return false;
    await deps.taskCommitCoordinator.dispatchTaskCommitPrompt(
      pi,
      ctx,
      state,
      commitTarget,
      options,
    );
    return true;
  }

  async function dispatchNextAutoWorkflowPrompt(
    pi: ExtensionAPI,
    ctx: unknown,
    allowSamePhase = false,
    options: FreshContinuationDispatchOptions = {},
  ): Promise<void> {
    const state = deps.getState(ctx);
    deps.setState(
      ctx,
      state,
      options.appendEntry === false ? undefined : deps.appendEntry(pi),
    );
    const refreshedState = deps.getState(ctx);
    const action = deps.nextActionForState(refreshedState, deps.baseCwd(ctx));
    const completedContinuation = completedPlanAutoContinuation(
      refreshedState,
      action,
      deps.baseCwd(ctx),
    );
    const dispatchState = completedContinuation?.state ?? refreshedState;
    const dispatchAction = completedContinuation?.action ?? action;
    if (completedContinuation) {
      deps.setState(
        ctx,
        completedContinuation.state,
        options.appendEntry === false ? undefined : deps.appendEntry(pi),
      );
    }
    const prompt = dispatchAction?.prompt;
    if (!prompt) {
      deps.notify(
        ctx,
        'Addy auto is active, but no active plan is available.',
        'warning',
      );
      return;
    }

    const actionPendingCommitTarget =
      deps.taskCommitCoordinator.actionCommitTarget(
        dispatchState,
        dispatchAction,
      );
    if (actionPendingCommitTarget) {
      await deps.taskCommitCoordinator.dispatchTaskCommitPrompt(
        pi,
        ctx,
        dispatchState,
        actionPendingCommitTarget,
        options,
      );
      return;
    }

    const pendingCommitTarget = latestCompletedActiveStatsTarget(
      dispatchState,
      deps.baseCwd(ctx),
    );
    if (
      pendingCommitTarget &&
      commandFromPrompt(dispatchState.autoLastPrompt) !==
        deps.autoTaskCommitPrompt
    ) {
      await deps.taskCommitCoordinator.dispatchTaskCommitPrompt(
        pi,
        ctx,
        dispatchState,
        pendingCommitTarget,
        options,
      );
      return;
    }

    const lifecycleSyncedState = stateWithCompletedLifecyclePhasesFromPlan(
      dispatchState,
      dispatchAction,
    );
    const phase = phaseFromWorkflowPrompt(prompt);
    const retryKey = autoRetryKey(lifecycleSyncedState, prompt);
    const isSameIncompletePhase =
      phase && phase === lifecycleSyncedState.current;
    const retryCount =
      lifecycleSyncedState.autoRetryKey === retryKey
        ? (lifecycleSyncedState.autoRetryCount ?? 0)
        : 0;
    if (
      !allowSamePhase &&
      isSameIncompletePhase &&
      retryCount >= deps.autoSamePhaseMaxRetries
    ) {
      deps.setState(
        ctx,
        { ...lifecycleSyncedState, autoPausedReason: 'same-phase-retry-limit' },
        options.appendEntry === false ? undefined : deps.appendEntry(pi),
      );
      deps.notify(ctx, autoPauseWarning(prompt, dispatchAction), 'warning');
      return;
    }

    const deliveryPrompt =
      !allowSamePhase && isSameIncompletePhase && retryCount >= 1
        ? autoRecoveryPrompt(prompt, dispatchAction, retryCount)
        : undefined;

    const reviewTask =
      phase === 'review'
        ? (dispatchAction?.taskTitle ?? lifecycleSyncedState.currentTask)
        : undefined;
    const finishTask =
      phase === 'finish' ? lifecycleSyncedState.autoReviewTask : undefined;
    const reviewTaskId =
      phase === 'review'
        ? (dispatchAction?.taskId ?? lifecycleSyncedState.currentTaskId)
        : undefined;
    const finishTaskId =
      phase === 'finish' ? lifecycleSyncedState.autoReviewTaskId : undefined;
    await dispatchAutoPromptFreshAware(
      pi,
      ctx,
      prompt,
      lifecycleSyncedState,
      {
        autoRetryKey: retryKey,
        autoRetryCount: isSameIncompletePhase ? retryCount + 1 : 0,
        autoReviewTask: reviewTask ?? finishTask,
        autoReviewTaskId: reviewTaskId ?? finishTaskId,
        autoReviewTaskIndex:
          phase === 'review'
            ? lifecycleSyncedState.currentTaskIndex
            : phase === 'finish'
              ? lifecycleSyncedState.autoReviewTaskIndex
              : undefined,
      },
      reviewTask || finishTask
        ? {
            taskId: reviewTaskId ?? finishTaskId,
            taskIndex:
              phase === 'review'
                ? lifecycleSyncedState.currentTaskIndex
                : lifecycleSyncedState.autoReviewTaskIndex,
            taskTitle: reviewTask ?? finishTask,
          }
        : undefined,
      options,
      deliveryPrompt,
    );
  }

  return {
    dispatchAutoPromptFreshAware,
    dispatchNextAutoWorkflowPrompt,
    maybeDispatchTaskCommit,
  };
}

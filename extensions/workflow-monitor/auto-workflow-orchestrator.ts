import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import {
  completedPlanAutoContinuation,
  latestCompletedActiveStatsTarget,
  planTaskIsComplete,
  reviewedTaskWasCompleted,
  type WorkflowAction,
} from './auto-lifecycle.ts';
import { planAutoWorkflowDecision } from './auto-workflow-decision.ts';
import { commandFromPrompt } from './command-router.ts';
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
    const actionPendingCommitTarget =
      deps.taskCommitCoordinator.actionCommitTarget(
        dispatchState,
        dispatchAction,
      );
    const pendingCommitTarget = latestCompletedActiveStatsTarget(
      dispatchState,
      deps.baseCwd(ctx),
    );
    const decision = planAutoWorkflowDecision({
      action: dispatchAction,
      actionPendingCommitTarget,
      allowSamePhase,
      autoSamePhaseMaxRetries: deps.autoSamePhaseMaxRetries,
      autoTaskCommitPrompt: deps.autoTaskCommitPrompt,
      pendingCommitTarget,
      state: dispatchState,
    });

    if (decision.kind === 'no-active-plan') {
      deps.notify(ctx, decision.message, 'warning');
      return;
    }
    if (decision.kind === 'task-commit') {
      await deps.taskCommitCoordinator.dispatchTaskCommitPrompt(
        pi,
        ctx,
        dispatchState,
        decision.target,
        options,
      );
      return;
    }
    if (decision.kind === 'pause') {
      deps.setState(
        ctx,
        decision.state,
        options.appendEntry === false ? undefined : deps.appendEntry(pi),
      );
      deps.notify(ctx, decision.message, 'warning');
      return;
    }

    await dispatchAutoPromptFreshAware(
      pi,
      ctx,
      decision.prompt,
      decision.state,
      decision.updates,
      decision.statsTarget,
      options,
      decision.deliveryPrompt,
    );
  }

  return {
    dispatchAutoPromptFreshAware,
    dispatchNextAutoWorkflowPrompt,
    maybeDispatchTaskCommit,
  };
}

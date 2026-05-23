import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { commandFromPrompt } from './command-router.ts';
import {
  reviewFindingsFingerprint,
  reviewTextHasActionableFindings,
} from './review-findings.ts';
import {
  clearReviewControlUpdates,
  legacyReviewFixKey,
  reviewFixKey,
} from './review-control.ts';
import { agentTextReportsCommitComplete } from './task-commit-coordinator.ts';
import type { AppendEntry } from './workflow-state-store.ts';
import type { WorkflowStatsTarget } from './workflow-stats.ts';
import type { WorkflowState } from './workflow-transitions.ts';

type WorkflowAction =
  | {
      prompt?: string;
      missingStatuses?: string[];
      taskId?: string;
      taskTitle?: string;
    }
  | undefined;

type AutoAgentEndDispatchOptions = {
  freshContextBypassReason?: string;
  appendEntry?: boolean;
  useDefaultDelivery?: boolean;
  idleTurnDelivery?: boolean;
  disableFreshSession?: boolean;
  disableCompaction?: boolean;
  allowSamePhase?: boolean;
};

type AutoAgentEndDeps = {
  appendEntry(pi: ExtensionAPI): AppendEntry;
  archiveWorkflowStats(state: WorkflowState, reason: string): WorkflowState;
  dispatchAutoPromptFreshAware(
    pi: ExtensionAPI,
    ctx: unknown,
    prompt: string,
    state: WorkflowState,
    updates?: Partial<WorkflowState>,
    statsTarget?: WorkflowStatsTarget,
    options?: AutoAgentEndDispatchOptions,
  ): Promise<void>;
  dispatchNextAutoWorkflowPrompt(
    pi: ExtensionAPI,
    ctx: unknown,
    allowSamePhase?: boolean,
    options?: AutoAgentEndDispatchOptions,
  ): Promise<void>;
  actionTargetsCompletePlanTask(
    state: WorkflowState,
    action: WorkflowAction,
    baseCwd?: string,
  ): boolean;
  maxReviewFixLoops(ctx: unknown): number;
  maybeDispatchTaskCommit(
    pi: ExtensionAPI,
    ctx: unknown,
    reviewText: string,
    previousState: WorkflowState,
    state: WorkflowState,
    action: WorkflowAction,
    options?: AutoAgentEndDispatchOptions,
  ): Promise<boolean>;
  notifyWarning(ctx: unknown, message: string): void;
  setState(ctx: unknown, state: WorkflowState, appendEntry?: AppendEntry): void;
  showWorkflowStats(
    pi: ExtensionAPI,
    ctx: unknown,
    state: WorkflowState,
    options?: { heading?: string; planPath?: string },
  ): void;
};

function activePlanPrompt(
  command: string,
  state: WorkflowState,
): string | undefined {
  return state.activePlan ? `${command} ${state.activePlan}` : undefined;
}

function activePlanPromptForTarget(
  command: string,
  state: WorkflowState,
  target?: WorkflowStatsTarget,
): string | undefined {
  const plan = target?.plan ?? state.activePlan;
  return plan ? `${command} ${plan}` : undefined;
}

export function finishTextReportsComplete(text: string): boolean {
  return (
    /(?:^|\s)Finished!(?:\s|$)/i.test(text) ||
    agentTextReportsCommitComplete(text)
  );
}

export function createAutoAgentEnd(deps: AutoAgentEndDeps) {
  function maybeCompleteAutoFinish(
    pi: ExtensionAPI,
    ctx: unknown,
    text: string,
    state: WorkflowState,
    action: WorkflowAction,
  ): boolean {
    if (commandFromPrompt(state.autoLastPrompt) !== '/addy-finish')
      return false;
    if (commandFromPrompt(action?.prompt) !== '/addy-finish') return false;
    if (!finishTextReportsComplete(text)) return false;

    const completedState = deps.archiveWorkflowStats(
      {
        ...state,
        phases: {
          ...state.phases,
          finish: 'complete',
        },
        autoMode: false,
        autoLastPrompt: undefined,
        autoRetryKey: undefined,
        autoRetryCount: undefined,
        autoFreshPrompt: undefined,
        autoFreshExpandedPrompt: undefined,
        autoFreshReason: undefined,
        autoFreshDeliveryKey: undefined,
        autoFreshConsumedKey: undefined,
        autoPendingAction: undefined,
        autoPausedReason: undefined,
        ...clearReviewControlUpdates(),
      },
      'completed',
    );
    deps.setState(ctx, completedState, deps.appendEntry(pi));
    deps.showWorkflowStats(pi, ctx, completedState, { heading: 'Finished!' });
    return true;
  }

  async function maybeDispatchReviewFixLoop(
    pi: ExtensionAPI,
    ctx: unknown,
    reviewText: string,
    state: WorkflowState,
    action: WorkflowAction,
    options: AutoAgentEndDispatchOptions = {},
  ): Promise<boolean> {
    const lastCommand = commandFromPrompt(state.autoLastPrompt);

    if (lastCommand === '/addy-fix-all') {
      const verifyPrompt = activePlanPrompt('/addy-verify', state);
      if (!verifyPrompt) return false;
      await deps.dispatchAutoPromptFreshAware(
        pi,
        ctx,
        verifyPrompt,
        state,
        { autoReviewFixNeedsReview: true },
        {
          taskIndex: state.autoReviewTaskIndex ?? state.currentTaskIndex,
          taskId: state.autoReviewTaskId ?? state.currentTaskId,
          taskTitle: state.autoReviewTask ?? state.currentTask,
        },
        options,
      );
      return true;
    }

    if (lastCommand === '/addy-verify' && state.autoReviewFixNeedsReview) {
      const target = {
        plan: state.activePlan,
        sliceIndex: state.currentSliceIndex,
        taskId: state.autoReviewTaskId ?? state.currentTaskId,
        taskIndex: state.autoReviewTaskIndex ?? state.currentTaskIndex,
        taskTitle:
          state.autoReviewTask && state.autoReviewTask !== 'none'
            ? state.autoReviewTask
            : state.currentTask,
      };
      const reviewPrompt = activePlanPromptForTarget(
        '/addy-review',
        state,
        target,
      );
      if (!reviewPrompt) return false;
      await deps.dispatchAutoPromptFreshAware(
        pi,
        ctx,
        reviewPrompt,
        state,
        {
          autoReviewFixNeedsReview: false,
          autoReviewTask: target.taskTitle,
          autoReviewTaskId: target.taskId,
          autoReviewTaskIndex: target.taskIndex,
        },
        target,
        options,
      );
      return true;
    }

    if (lastCommand !== '/addy-review') return false;

    const hasActionableFindings = reviewTextHasActionableFindings(reviewText);
    const cleanReviewNeedsPlanSync = Boolean(
      reviewText.trim() &&
      !hasActionableFindings &&
      commandFromPrompt(action?.prompt) === '/addy-review' &&
      action?.missingStatuses?.includes('Reviewed') &&
      action?.taskTitle &&
      state.currentTask === action.taskTitle &&
      !deps.actionTargetsCompletePlanTask(
        state,
        action,
        (ctx as { cwd?: string }).cwd,
      ),
    );
    if (!hasActionableFindings && !cleanReviewNeedsPlanSync) return false;

    const key = reviewFixKey(state);
    const legacyKey = legacyReviewFixKey(state);
    const sameReviewFixKey =
      state.autoReviewFixKey === key || state.autoReviewFixKey === legacyKey;
    const fixCount = sameReviewFixKey ? (state.autoReviewFixCount ?? 0) : 0;
    const maxFixLoops = deps.maxReviewFixLoops(ctx);
    const fingerprint = cleanReviewNeedsPlanSync
      ? reviewFindingsFingerprint(
          `Reviewed checkbox still unchecked for ${key}.`,
        )
      : reviewFindingsFingerprint(reviewText);

    if (fixCount > 0 && state.autoReviewFindingFingerprint === fingerprint) {
      deps.setState(
        ctx,
        { ...state, autoPausedReason: 'repeated-review-finding' },
        deps.appendEntry(pi),
      );
      deps.notifyWarning(
        ctx,
        `Addy auto paused after /addy-review; the same review finding repeated after a fix attempt. Task: ${action?.taskTitle ?? 'current task'}.`,
      );
      return true;
    }

    if (fixCount >= maxFixLoops) {
      deps.setState(
        ctx,
        { ...state, autoPausedReason: 'max-review-fix-loops' },
        deps.appendEntry(pi),
      );
      deps.notifyWarning(
        ctx,
        `Addy auto paused after ${maxFixLoops} review fix loops for this task. Task: ${action?.taskTitle ?? 'current task'}.`,
      );
      return true;
    }

    const fixPrompt = activePlanPrompt('/addy-fix-all', state);
    if (!fixPrompt) return false;
    await deps.dispatchAutoPromptFreshAware(
      pi,
      ctx,
      fixPrompt,
      state,
      {
        autoReviewFixKey: key,
        autoReviewFixCount: fixCount + 1,
        autoReviewFindingFingerprint: fingerprint,
      },
      undefined,
      options,
    );
    return true;
  }

  async function continueAfterAgentEnd(
    pi: ExtensionAPI,
    ctx: unknown,
    text: string,
    previousState: WorkflowState,
    state: WorkflowState,
    action: WorkflowAction,
    options: AutoAgentEndDispatchOptions = {},
  ): Promise<void> {
    if (maybeCompleteAutoFinish(pi, ctx, text, state, action)) return;
    if (await maybeDispatchReviewFixLoop(pi, ctx, text, state, action, options))
      return;
    if (
      await deps.maybeDispatchTaskCommit(
        pi,
        ctx,
        text,
        previousState,
        state,
        action,
        options,
      )
    )
      return;
    await deps.dispatchNextAutoWorkflowPrompt(pi, ctx, false, options);
  }

  return {
    maybeCompleteAutoFinish,
    maybeDispatchReviewFixLoop,
    continueAfterAgentEnd,
  };
}

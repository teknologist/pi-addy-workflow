import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { commandFromPrompt } from './command-router.ts';
import {
  reviewFindingsFingerprint,
  reviewTextHasActionableFindings,
} from './review-findings.ts';
import { legacyReviewFixKey, reviewFixKey } from './review-control.ts';
import type { WorkflowDispatchOptions } from './workflow-dispatch-options.ts';
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

type AutoAgentEndDispatchOptions = WorkflowDispatchOptions;

export type AutoReviewFixLoopDeps = {
  appendEntry(pi: ExtensionAPI): AppendEntry;
  dispatchAutoPromptFreshAware(
    pi: ExtensionAPI,
    ctx: unknown,
    prompt: string,
    state: WorkflowState,
    updates?: Partial<WorkflowState>,
    statsTarget?: WorkflowStatsTarget,
    options?: AutoAgentEndDispatchOptions,
  ): Promise<void>;
  actionTargetsCompletePlanTask(
    state: WorkflowState,
    action: WorkflowAction,
    baseCwd?: string,
  ): boolean;
  maxReviewFixLoops(ctx: unknown): number;
  notifyWarning(ctx: unknown, message: string): void;
  setState(ctx: unknown, state: WorkflowState, appendEntry?: AppendEntry): void;
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

export async function maybeDispatchReviewFixLoop(
  deps: AutoReviewFixLoopDeps,
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
    ? reviewFindingsFingerprint(`Reviewed checkbox still unchecked for ${key}.`)
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

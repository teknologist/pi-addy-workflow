import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import {
  finishTextReportsComplete,
  maybeCompleteAutoFinish as completeAutoFinish,
} from './auto-agent-finish.ts';
import { maybeDispatchReviewFixLoop as dispatchReviewFixLoop } from './auto-review-fix-loop.ts';
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

export { finishTextReportsComplete };

export function createAutoAgentEnd(deps: AutoAgentEndDeps) {
  function maybeCompleteAutoFinish(
    pi: ExtensionAPI,
    ctx: unknown,
    text: string,
    state: WorkflowState,
    action: WorkflowAction,
  ): boolean {
    return completeAutoFinish(deps, pi, ctx, text, state, action);
  }

  function maybeDispatchReviewFixLoop(
    pi: ExtensionAPI,
    ctx: unknown,
    reviewText: string,
    state: WorkflowState,
    action: WorkflowAction,
    options: AutoAgentEndDispatchOptions = {},
  ): Promise<boolean> {
    return dispatchReviewFixLoop(
      deps,
      pi,
      ctx,
      reviewText,
      state,
      action,
      options,
    );
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

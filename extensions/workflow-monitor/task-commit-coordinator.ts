import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { loadAddyWorkflowConfig } from './config.ts';
import { commandFromPrompt } from './command-router.ts';
import {
  agentTextReportsCommitComplete,
  commitShaFromAgentText,
} from './commit-result.ts';
import { planTaskClosureContinuation } from './task-closure-continuation.ts';
import { autoTaskCommitPrompt } from './task-commit-prompt.ts';
import {
  actionCommitTarget,
  recordCommittedTask,
  withPlanTaskId,
} from './task-commit-target.ts';
import type { WorkflowStatsTarget } from './workflow-stats.ts';
import type { WorkflowDispatchOptions } from './workflow-dispatch-options.ts';
import type { AppendEntry } from './workflow-state-store.ts';
import type { AutoFreshReason, WorkflowState } from './workflow-transitions.ts';
import {
  ADDY_AUTO_TASK_COMMIT_PROMPT,
  nextUnfinishedSlicePlanPath,
  nextWorkflowActionForActivePlanLifecycle,
} from './workflow-tracker.ts';

type TaskCommitDispatchOptions = WorkflowDispatchOptions;

type WorkflowAction = ReturnType<
  typeof nextWorkflowActionForActivePlanLifecycle
>;

const UNCONFIRMED_TASK_COMMIT_SHA = 'unconfirmed';

type TaskCommitCoordinatorDeps = {
  appendEntry(pi: ExtensionAPI): AppendEntry;
  archiveWorkflowStats(state: WorkflowState, reason: string): WorkflowState;
  dispatchAutoPromptFreshAware(
    pi: ExtensionAPI,
    ctx: unknown,
    prompt: string,
    state: WorkflowState,
    updates?: Partial<WorkflowState>,
    statsTarget?: WorkflowStatsTarget,
    options?: TaskCommitDispatchOptions,
    deliveryPrompt?: string,
  ): Promise<void>;
  dispatchNextAutoWorkflowPrompt(
    pi: ExtensionAPI,
    ctx: unknown,
    allowSamePhase?: boolean,
    options?: TaskCommitDispatchOptions,
  ): Promise<void>;
  expandPackagedPromptTemplate(prompt: string): string;
  freshContinuation: {
    runFreshContextContinuation(
      pi: ExtensionAPI,
      ctx: unknown,
      reason: AutoFreshReason,
    ): Promise<void>;
    resumePendingFreshContinuation(
      pi: ExtensionAPI,
      ctx: unknown,
      options: TaskCommitDispatchOptions,
      mode?: 'current-session' | 'after-compaction',
    ): Promise<'none' | 'stale-cleared' | 'delivered'>;
  };
  latestActiveStatsTarget(
    state: WorkflowState,
  ): WorkflowStatsTarget | undefined;
  notify(ctx: unknown, message: string, level?: string): void;
  setState(ctx: unknown, state: WorkflowState, appendEntry?: AppendEntry): void;
};

export {
  agentTextReportsCommitComplete,
  commitShaFromAgentText,
} from './commit-result.ts';
export { autoTaskCommitPrompt } from './task-commit-prompt.ts';
export { actionCommitTarget, withPlanTaskId } from './task-commit-target.ts';

export function createTaskCommitCoordinator(deps: TaskCommitCoordinatorDeps) {
  async function dispatchTaskCommitPrompt(
    pi: ExtensionAPI,
    ctx: unknown,
    state: WorkflowState,
    target: WorkflowStatsTarget,
    options: TaskCommitDispatchOptions = {},
  ): Promise<void> {
    const commitPrompt = autoTaskCommitPrompt(
      { ...state, activePlan: target.plan ?? state.activePlan },
      target.taskTitle,
      (ctx as { cwd?: string }).cwd,
    );
    await deps.dispatchAutoPromptFreshAware(
      pi,
      ctx,
      ADDY_AUTO_TASK_COMMIT_PROMPT,
      state,
      {
        autoLastPrompt: ADDY_AUTO_TASK_COMMIT_PROMPT,
        autoReviewFixNeedsReview: undefined,
        autoReviewTask: undefined,
        autoReviewTaskId: undefined,
        autoReviewTaskIndex: undefined,
      },
      target,
      { ...options, useDefaultDelivery: true, idleTurnDelivery: true },
      `${commitPrompt}\n\nInvocation: \`${ADDY_AUTO_TASK_COMMIT_PROMPT}\``,
    );
  }

  async function maybeContinueAfterTaskCommit(
    pi: ExtensionAPI,
    ctx: unknown,
    text: string,
    state: WorkflowState,
    options: TaskCommitDispatchOptions = {},
  ): Promise<boolean> {
    if (
      commandFromPrompt(state.autoLastPrompt) !== ADDY_AUTO_TASK_COMMIT_PROMPT
    )
      return false;

    const cwd = (ctx as { cwd?: string }).cwd;
    const actionTarget = actionCommitTarget(
      state,
      nextWorkflowActionForActivePlanLifecycle(state, cwd),
    );
    const committedTarget = actionTarget?.taskId
      ? actionTarget
      : (deps.latestActiveStatsTarget(state) ?? actionTarget);
    const targetWithTaskId = withPlanTaskId(committedTarget, cwd);
    const stateAfterCommit = {
      ...deps.archiveWorkflowStats(
        recordCommittedTask(
          state,
          targetWithTaskId,
          agentTextReportsCommitComplete(text)
            ? commitShaFromAgentText(text)
            : UNCONFIRMED_TASK_COMMIT_SHA,
        ),
        'task-commit',
      ),
      autoPendingAction: undefined,
      autoPausedReason: undefined,
      autoReviewTask: targetWithTaskId?.taskTitle,
      autoReviewTaskId: targetWithTaskId?.taskId,
      autoReviewTaskIndex: targetWithTaskId?.taskIndex,
    };
    const nextSlicePlan = nextUnfinishedSlicePlanPath(stateAfterCommit, cwd);
    const continuationPlan = planTaskClosureContinuation({
      stateAfterCommit,
      nextSlicePlan,
      nextAction: (continuationState) => {
        const action = nextWorkflowActionForActivePlanLifecycle(
          continuationState,
          cwd,
        );
        return {
          prompt: action?.prompt,
          expandedPrompt: action?.prompt
            ? deps.expandPackagedPromptTemplate(action.prompt)
            : undefined,
        };
      },
      freshContextBetweenTasks: loadAddyWorkflowConfig(
        ctx as {
          cwd?: string;
          ui?: { notify?: (msg: string, level?: string) => void };
        },
      ).auto.freshContext.betweenTasks,
      disableFreshSession: options.disableFreshSession,
    });
    deps.setState(ctx, continuationPlan.state, deps.appendEntry(pi));

    if (continuationPlan.kind === 'stop') return true;

    if (continuationPlan.kind === 'pending-fresh') {
      deps.setState(ctx, continuationPlan.pendingState, deps.appendEntry(pi));
      if (continuationPlan.useCurrentSession)
        await deps.freshContinuation.resumePendingFreshContinuation(
          pi,
          ctx,
          {
            ...options,
            freshContextBypassReason: 'between-tasks',
            useDefaultDelivery: true,
          },
          'after-compaction',
        );
      else
        await deps.freshContinuation.runFreshContextContinuation(
          pi,
          ctx,
          'between-tasks',
        );
      return true;
    }

    await deps.dispatchNextAutoWorkflowPrompt(
      pi,
      ctx,
      options.allowSamePhase ?? false,
      options,
    );
    return true;
  }

  return {
    actionCommitTarget,
    dispatchTaskCommitPrompt,
    maybeContinueAfterTaskCommit,
    withPlanTaskId,
  };
}

export type { TaskCommitDispatchOptions };

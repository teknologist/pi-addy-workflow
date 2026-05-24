import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { readFileSync } from 'node:fs';
import { loadAddyWorkflowConfig } from './config.ts';
import { commandFromPrompt } from './command-router.ts';
import {
  agentTextReportsCommitComplete,
  commitShaFromAgentText,
} from './commit-result.ts';
import { resolvePlanTaskTarget } from './plan-task-resolution.ts';
import { repositoryScopeForPlan } from './repository-scope.ts';
import { planTaskClosureContinuation } from './task-closure-continuation.ts';
import type { WorkflowStatsTarget } from './workflow-stats.ts';
import { resolveWorkflowPlanPath } from './workflow-plan-path.ts';
import type { WorkflowDispatchOptions } from './workflow-dispatch-options.ts';
import type { AppendEntry } from './workflow-state-store.ts';
import type { AutoFreshReason, WorkflowState } from './workflow-transitions.ts';
import {
  ADDY_AUTO_TASK_COMMIT_PROMPT,
  nextUnfinishedSlicePlanPath,
  nextWorkflowActionForActivePlanLifecycle,
  planTasksFromMarkdown,
  workflowTaskCommitKey,
} from './workflow-tracker.ts';

type TaskCommitDispatchOptions = WorkflowDispatchOptions;

type WorkflowAction = ReturnType<
  typeof nextWorkflowActionForActivePlanLifecycle
>;

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

export function autoTaskCommitPrompt(
  state: WorkflowState,
  taskTitle?: string,
  baseCwd?: string,
): string {
  const task =
    taskTitle ??
    (state.currentTask && state.currentTask !== 'none'
      ? state.currentTask
      : 'the completed task');
  const plan = state.activePlan
    ? `Plan: ${state.activePlan}`
    : 'Plan: active Addy workflow plan';
  const repositoryScope = repositoryScopeForPlan(state.activePlan, baseCwd);
  const repositoryLine = repositoryScope
    ? `Repository scope: ${repositoryScope}`
    : 'Repository scope: current repository';
  return [
    '# Addy Auto Commit',
    '',
    'The current task has Implemented, Verified, and Reviewed checked. Commit the completed task work now, without asking the user for confirmation.',
    '',
    plan,
    repositoryLine,
    `Completed task: ${task}`,
    '',
    'Required steps:',
    '1. Do not try to invoke, search for, or print a `/commit` slash command; this auto prompt is the commit instruction.',
    '2. Use the full repository scope above instead of relying on fresh-session file-touch history.',
    '3. With the available shell/git tools, inspect each repo in scope (for example, `git -C <repo> status --short`).',
    '4. Before staging, run the project formatter for the changed scope when one is available, then run the project lint/format check for the changed scope. If formatting or lint changes files, include those changes; if lint/format still fails, fix safe scoped issues and rerun before committing.',
    '5. Stage all current changed files in each repo in scope, including tracked, unstaged, untracked, and plan checkbox changes. Do not leave relevant dirty worktree changes behind.',
    '6. Review the staged diff, then create a concise commit in each repo that has staged task changes.',
    '7. If there are no changes in any relevant repo, say `No changes to commit` and stop.',
    '8. Report each commit hash in the form `COMMIT: <hash>`.',
    '',
    'Do not call ask_user_question. Do not start the next task yourself; Addy auto will continue after this commit turn ends.',
  ].join('\n');
}

export function withPlanTaskId(
  target: WorkflowStatsTarget | undefined,
  baseCwd?: string,
): WorkflowStatsTarget | undefined {
  if (!target?.plan || (!target.taskId && !target.taskTitle)) return target;
  try {
    const tasks = planTasksFromMarkdown(
      readFileSync(resolveWorkflowPlanPath(target.plan, baseCwd), 'utf8'),
    );
    const resolved = resolvePlanTaskTarget(tasks, target);
    if (!resolved?.task.taskId) return target;
    if (
      !target.taskId &&
      target.taskTitle &&
      resolved.task.title !== target.taskTitle
    )
      return target;
    return {
      ...target,
      taskId: resolved.task.taskId,
      taskIndex: resolved.taskIndex,
      taskTitle: resolved.task.title,
    };
  } catch {
    return target;
  }
}

function recordCommittedTask(
  state: WorkflowState,
  target: WorkflowStatsTarget | undefined,
  commitSha: string,
): WorkflowState {
  const plan = target?.plan ?? state.activePlan;
  const taskId = target?.taskId;
  const taskIndex = target?.taskIndex ?? state.currentTaskIndex;
  const taskTitle = target?.taskTitle ?? state.currentTask;
  if (!plan || !taskIndex || !taskTitle || taskTitle === 'none') return state;

  const key = workflowTaskCommitKey(plan, taskIndex, taskTitle, taskId);
  return {
    ...state,
    committedTasks: {
      ...state.committedTasks,
      [key]: {
        plan,
        ...(taskId ? { taskId } : {}),
        sliceIndex: target?.sliceIndex ?? state.currentSliceIndex,
        taskIndex,
        taskTitle,
        commitSha,
        committedAt: new Date().toISOString(),
      },
    },
  };
}

export function actionCommitTarget(
  state: WorkflowState,
  action: WorkflowAction,
): WorkflowStatsTarget | undefined {
  if (!action?.requiresCommit || !action.taskTitle) return undefined;
  return {
    plan: action.plan ?? state.activePlan,
    taskId: action.taskId,
    sliceIndex: action.currentSliceIndex ?? state.currentSliceIndex,
    taskIndex: action.taskIndex ?? state.currentTaskIndex,
    taskTitle: action.taskTitle,
  };
}

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

    if (!agentTextReportsCommitComplete(text)) {
      deps.setState(
        ctx,
        { ...state, autoPausedReason: 'unclear-commit-result' },
        deps.appendEntry(pi),
      );
      deps.notify(
        ctx,
        'Addy auto paused after the task commit step; the commit result was unclear. Commit or clean the worktree, then rerun /addy-auto.',
        'warning',
      );
      return true;
    }

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
          commitShaFromAgentText(text),
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

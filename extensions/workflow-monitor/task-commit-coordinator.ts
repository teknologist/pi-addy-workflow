import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { readFileSync } from 'node:fs';
import { loadAddyWorkflowConfig } from './config.ts';
import { planPendingFreshDispatch } from './command-dispatch.ts';
import { commandFromPrompt } from './command-router.ts';
import { repositoryScopeForPlan } from './repository-scope.ts';
import type { WorkflowStatsTarget } from './workflow-stats.ts';
import { resolveWorkflowPlanPath } from './workflow-plan-path.ts';
import type { AppendEntry } from './workflow-state-store.ts';
import type { AutoFreshReason, WorkflowState } from './workflow-transitions.ts';
import {
  ADDY_AUTO_TASK_COMMIT_PROMPT,
  nextUnfinishedSlicePlanPath,
  nextWorkflowActionForActivePlanLifecycle,
  planTasksFromMarkdown,
  workflowTaskCommitKey,
} from './workflow-tracker.ts';

type TaskCommitDispatchOptions = {
  freshContextBypassReason?: AutoFreshReason;
  appendEntry?: boolean;
  useDefaultDelivery?: boolean;
  idleTurnDelivery?: boolean;
  disableFreshSession?: boolean;
  disableCompaction?: boolean;
  allowSamePhase?: boolean;
};

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
    schedulePendingFreshPromptAfterCompaction(
      pi: ExtensionAPI,
      ctx: unknown,
      state: WorkflowState & {
        autoFreshPrompt: string;
        autoFreshReason: AutoFreshReason;
      },
      options: TaskCommitDispatchOptions,
    ): boolean;
  };
  latestActiveStatsTarget(
    state: WorkflowState,
  ): WorkflowStatsTarget | undefined;
  notify(ctx: unknown, message: string, level?: string): void;
  setState(ctx: unknown, state: WorkflowState, appendEntry?: AppendEntry): void;
  validPendingFreshContinuation(
    state: WorkflowState,
  ): state is WorkflowState & {
    autoFreshPrompt: string;
    autoFreshReason: AutoFreshReason;
  };
};

export function agentTextReportsCommitComplete(text: string): boolean {
  if (
    /\b(commit failed|failed to commit|commit error|nothing committed)\b/i.test(
      text,
    )
  )
    return false;

  return (
    /\bCOMMIT:\s*[0-9a-f]{7,40}\b/i.test(text) ||
    /\b(?:committed|created commit|commit(?:ted)? hash(?: is)?):?\s*`?[0-9a-f]{7,40}`?\b/i.test(
      text,
    ) ||
    /\[[^\]\r\n]+\s+[0-9a-f]{7,40}\]\s+/i.test(text) ||
    /\b(no changes to commit|nothing to commit|working tree clean)\b/i.test(
      text,
    )
  );
}

export function commitShaFromAgentText(text: string): string {
  return (
    text.match(/\bCOMMIT:\s*([0-9a-f]{7,40})\b/i)?.[1] ??
    text.match(
      /\b(?:committed|created commit|commit(?:ted)? hash(?: is)?):?\s*`?([0-9a-f]{7,40})`?\b/i,
    )?.[1] ??
    text.match(/\[[^\]\r\n]+\s+([0-9a-f]{7,40})\]\s+/i)?.[1] ??
    'no-changes'
  );
}

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
    const task = target.taskId
      ? tasks.find((candidate) => candidate.taskId === target.taskId)
      : target.taskIndex
        ? tasks[target.taskIndex - 1]
        : tasks.find((candidate) => candidate.title === target.taskTitle);
    if (!task?.taskId) return target;
    if (!target.taskId && target.taskTitle && task.title !== target.taskTitle)
      return target;
    return {
      ...target,
      taskId: task.taskId,
      taskIndex: tasks.indexOf(task) + 1,
      taskTitle: task.title,
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
    const continuationState = nextSlicePlan
      ? {
          ...stateAfterCommit,
          activePlan: nextSlicePlan,
          activeSuitePlan:
            stateAfterCommit.activeSuitePlan ?? stateAfterCommit.activePlan,
          currentTask: undefined,
          currentTaskId: undefined,
          nextTask: undefined,
          nextTaskId: undefined,
          currentTaskIndex: undefined,
          taskCount: undefined,
          currentTaskSummary: undefined,
          nextTaskSummary: undefined,
        }
      : stateAfterCommit;
    deps.setState(ctx, continuationState, deps.appendEntry(pi));
    const nextAction = nextWorkflowActionForActivePlanLifecycle(
      continuationState,
      cwd,
    );
    if (commandFromPrompt(nextAction?.prompt) === '/addy-finish') {
      await deps.dispatchNextAutoWorkflowPrompt(
        pi,
        ctx,
        options.allowSamePhase ?? false,
        options,
      );
      return true;
    }
    if (
      loadAddyWorkflowConfig(
        ctx as {
          cwd?: string;
          ui?: { notify?: (msg: string, level?: string) => void };
        },
      ).auto.freshContext.betweenTasks
    ) {
      if (!nextAction?.prompt) return true;
      const freshContinuationState = {
        ...continuationState,
        autoReviewTask: undefined,
        autoReviewTaskId: undefined,
        autoReviewTaskIndex: undefined,
      };
      const pendingFreshPlan = planPendingFreshDispatch({
        prompt: nextAction.prompt,
        reason: 'between-tasks',
        state: freshContinuationState,
        expandedPrompt: deps.expandPackagedPromptTemplate(nextAction.prompt),
      });
      deps.setState(ctx, pendingFreshPlan.state, deps.appendEntry(pi));
      if (options.disableFreshSession) {
        const pendingState = pendingFreshPlan.state;
        if (deps.validPendingFreshContinuation(pendingState))
          deps.freshContinuation.schedulePendingFreshPromptAfterCompaction(
            pi,
            ctx,
            pendingState,
            {
              ...options,
              freshContextBypassReason: 'between-tasks',
              useDefaultDelivery: true,
            },
          );
      } else
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

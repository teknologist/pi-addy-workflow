import { createHash } from 'node:crypto';
import { commandFromPrompt, workflowTextFromInput } from './command-router.ts';
import {
  ADDY_AUTO_TASK_COMMIT_PROMPT,
  type nextWorkflowActionForActivePlanLifecycle,
} from './workflow-tracker.ts';
import type { WorkflowStatsTarget } from './workflow-stats.ts';
import type { WorkflowState } from './workflow-transitions.ts';

type AutoWorkflowAction = ReturnType<
  typeof nextWorkflowActionForActivePlanLifecycle
>;

type TaskIdentity = {
  taskId?: string;
  taskIndex?: number;
  taskTitle?: string;
};

function hasLegacyTaskIdentity(identity: TaskIdentity): boolean {
  return identity.taskIndex !== undefined || identity.taskTitle !== undefined;
}

function legacyTaskIdentityMatches(
  identity: TaskIdentity,
  candidate: TaskIdentity,
): boolean {
  if (!hasLegacyTaskIdentity(identity)) return true;
  return (
    (identity.taskIndex === undefined ||
      identity.taskIndex === candidate.taskIndex) &&
    (identity.taskTitle === undefined ||
      identity.taskTitle === candidate.taskTitle)
  );
}

function taskIdForIdentity(
  identity: TaskIdentity,
  candidates: TaskIdentity[],
): string | undefined {
  if (identity.taskId) return identity.taskId;
  return candidates.find(
    (candidate) =>
      candidate.taskId && legacyTaskIdentityMatches(identity, candidate),
  )?.taskId;
}

export function idleUserMessageKey(ctx: unknown, message: string): string {
  const contextId = (ctx as { id?: unknown }).id;
  const cwd = (ctx as { cwd?: unknown }).cwd;
  return createHash('sha256')
    .update(`${typeof contextId === 'string' ? contextId : ''}\u001f`)
    .update(`${typeof cwd === 'string' ? cwd : ''}\u001f`)
    .update(message)
    .digest('hex')
    .slice(0, 16);
}

export function autoWorkflowActionKey(
  prompt: string,
  details: {
    plan?: string;
    taskId?: string;
    sliceIndex?: number;
    taskIndex?: number;
    taskTitle?: string;
    requiresCommit?: boolean;
  } = {},
): string {
  const taskIdentity = details.taskId
    ? ['task-id', details.taskId]
    : [details.taskIndex ?? '', details.taskTitle ?? ''];
  return [
    commandFromPrompt(prompt) ?? prompt,
    details.plan ?? '',
    details.sliceIndex ?? '',
    ...taskIdentity,
    details.requiresCommit ? 'commit' : '',
  ].join('\u001f');
}

export function autoWorkflowActionKeyForAction(
  state: WorkflowState,
  action: AutoWorkflowAction,
): string | undefined {
  if (!action?.prompt) return undefined;
  const actionIdentity = {
    taskId: action.taskId,
    taskIndex: action.taskIndex,
    taskTitle: action.taskTitle,
  };
  return autoWorkflowActionKey(action.prompt, {
    plan: action.plan ?? state.activePlan,
    taskId: taskIdForIdentity(actionIdentity, [
      {
        taskId: state.currentTaskId,
        taskIndex: state.currentTaskIndex,
        taskTitle: state.currentTask,
      },
    ]),
    sliceIndex: action.currentSliceIndex ?? state.currentSliceIndex,
    taskIndex: action.taskIndex ?? state.currentTaskIndex,
    taskTitle: action.taskTitle ?? state.currentTask,
    requiresCommit: action.requiresCommit,
  });
}

export function autoWorkflowActionKeyForPromptState(
  prompt: string,
  state: WorkflowState,
  target: WorkflowStatsTarget | undefined,
): string {
  const targetIdentity = {
    taskId: target?.taskId,
    taskIndex: target?.taskIndex,
    taskTitle: target?.taskTitle,
  };
  return autoWorkflowActionKey(prompt, {
    plan: target?.plan ?? state.activePlan,
    taskId: taskIdForIdentity(targetIdentity, [
      {
        taskId: state.autoReviewTaskId,
        taskIndex: state.autoReviewTaskIndex,
        taskTitle: state.autoReviewTask,
      },
      {
        taskId: state.currentTaskId,
        taskIndex: state.currentTaskIndex,
        taskTitle: state.currentTask,
      },
    ]),
    sliceIndex: target?.sliceIndex ?? state.currentSliceIndex,
    taskIndex:
      target?.taskIndex ?? state.autoReviewTaskIndex ?? state.currentTaskIndex,
    taskTitle: target?.taskTitle ?? state.autoReviewTask ?? state.currentTask,
    requiresCommit: commandFromPrompt(prompt) === ADDY_AUTO_TASK_COMMIT_PROMPT,
  });
}

export function currentAutoWorkflowActionKey(
  state: WorkflowState,
  target?: WorkflowStatsTarget,
): string | undefined {
  const prompt = state.autoLastPrompt
    ? workflowTextFromInput(state.autoLastPrompt)
    : state.autoPendingAction?.prompt;
  if (!prompt) return undefined;
  return autoWorkflowActionKeyForPromptState(prompt, state, target);
}

import { createHash } from 'node:crypto';
import { commandFromPrompt, workflowTextFromInput } from './command-router.ts';
import { ADDY_AUTO_TASK_COMMIT_PROMPT } from './workflow-tracker.ts';
import type { WorkflowAction } from './auto-lifecycle.ts';
import type {
  TicketOperation,
  TicketRunState,
  WorkflowTicketPendingAction,
} from './workflow-core.ts';
import type { WorkflowStatsTarget } from './workflow-stats.ts';
import type { WorkflowState } from './workflow-transitions.ts';
import {
  taskIdentityKeyParts,
  taskIdForIdentity,
  workflowSourceIdentityKey,
  type TicketSliceIdentity,
  type WorkflowTaskIdentity,
} from './workflow-task-identity.ts';

const TICKET_OPERATIONS_BY_COMMAND: Partial<Record<string, TicketOperation>> = {
  '/addy-build': 'build',
  '/addy-code-simplify': 'simplify',
  '/addy-verify': 'verify',
  '/addy-review': 'review',
  '/addy-fix-all': 'fix-all',
  '/addy-finish': 'finish',
};

const CLAIM_REQUIRED_TICKET_OPERATIONS = new Set<TicketOperation>(
  Object.values(TICKET_OPERATIONS_BY_COMMAND).filter(
    (operation): operation is TicketOperation => operation !== undefined,
  ),
);

export function ticketOperationFromPrompt(
  prompt: string,
): TicketOperation | undefined {
  return TICKET_OPERATIONS_BY_COMMAND[commandFromPrompt(prompt) ?? ''];
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

export function ticketAutoWorkflowActionKey(
  identity: TicketSliceIdentity,
  operation: TicketOperation,
  attemptMarker: string,
): string {
  return [workflowSourceIdentityKey(identity), operation, attemptMarker].join(
    '\u001f',
  );
}

export function ticketPendingActionMatches(
  pending: WorkflowTicketPendingAction,
  run: TicketRunState,
  operation: TicketOperation,
): boolean {
  if (CLAIM_REQUIRED_TICKET_OPERATIONS.has(operation) && !run.claim)
    return false;
  return (
    pending.operation === operation &&
    pending.sourceKind === run.source.kind &&
    pending.ticketRef === run.source.ref &&
    pending.runId === run.runId &&
    pending.claimId === run.claim?.id
  );
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
  const taskIdentity = taskIdentityKeyParts(details);
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
  action: WorkflowAction,
): string | undefined {
  if (!action?.prompt) return undefined;
  if (action.executionSource === 'ticket')
    return ticketAutoWorkflowActionKey(
      action,
      action.operation,
      action.attemptMarker,
    );
  const actionIdentity: WorkflowTaskIdentity = {
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
  if (state.executionSource === 'ticket' && state.ticketRun) {
    const operation = ticketOperationFromPrompt(prompt);
    if (!operation)
      throw new Error(
        `Cannot identify Ticket operation for pending action: ${prompt}`,
      );
    const pending = state.autoPendingAction;
    const attemptMarker =
      pending?.executionSource === 'ticket' &&
      ticketPendingActionMatches(pending, state.ticketRun, operation)
        ? pending.attemptMarker
        : 'attempt-0';
    return ticketAutoWorkflowActionKey(
      {
        source: 'ticket',
        sourceKind: state.ticketRun.source.kind,
        ticketRef: state.ticketRun.source.ref,
        runId: state.ticketRun.runId,
        claimId: state.ticketRun.claim?.id,
      },
      operation,
      attemptMarker,
    );
  }
  const targetIdentity: WorkflowTaskIdentity = {
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

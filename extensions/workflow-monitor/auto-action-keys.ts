import { createHash } from 'node:crypto';
import { commandFromPrompt, workflowTextFromInput } from './command-router.ts';
import { normalizeTicketRepositoryRequest } from './repository-scope.ts';
import { parseTicketCommand } from './ticket-command.ts';
import { tokenizeCommandLine } from './workflow-host-events.ts';
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

function ticketIntentFromPrompt(prompt: string) {
  const [command, ...args] = tokenizeCommandLine(workflowTextFromInput(prompt));
  return parseTicketCommand(command ?? '', args);
}

export function ticketSelectorFromPrompt(
  prompt: string,
): TicketRunState['queueSelector'] {
  const intent = ticketIntentFromPrompt(prompt);
  return intent.kind === 'ticket-queue' ? intent.selector : undefined;
}

export function ticketRefFromPrompt(prompt: string): string | undefined {
  const intent = ticketIntentFromPrompt(prompt);
  return intent.kind === 'ticket-lifecycle' ||
    intent.kind === 'ticket-management'
    ? intent.ticketRef
    : undefined;
}

export function ticketOperationFromPrompt(
  prompt: string,
): TicketOperation | undefined {
  const command = commandFromPrompt(prompt) ?? '';
  const lifecycle = TICKET_OPERATIONS_BY_COMMAND[command];
  if (lifecycle) return lifecycle;
  if (command !== '/addy-ticket' && command !== '/addy-auto') return undefined;
  const intent = ticketIntentFromPrompt(prompt);
  if (intent.kind === 'ticket-management') return intent.operation;
  return intent.kind === 'ticket-queue' ? 'select' : undefined;
}

export function ticketOperationIdentityFromPrompt(
  prompt: string,
  run: TicketRunState,
  operation: TicketOperation,
): Pick<TicketSliceIdentity, 'selector' | 'repository'> {
  const intent = ticketIntentFromPrompt(prompt);
  if (operation === 'select') {
    const selector = ticketSelectorFromPrompt(prompt) ?? run.queueSelector;
    return selector ? { selector } : {};
  }
  if (operation === 'add-repository')
    return intent.kind === 'ticket-management' &&
      intent.operation === 'add-repository'
      ? {
          repository: normalizeTicketRepositoryRequest(
            intent.repository,
            run.repositoryRoot,
          ),
        }
      : {};
  return operation === 'repository-scope-approval' && run.pendingScopeRequest
    ? { repository: run.pendingScopeRequest.repository }
    : {};
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
  const operationIdentity =
    operation === 'reclaim'
      ? (identity.staleClaimId ?? '')
      : operation === 'select'
        ? `${identity.selector?.kind ?? ''}:${identity.selector?.value ?? ''}`
        : operation === 'add-repository' ||
            operation === 'repository-scope-approval'
          ? (identity.repository ?? '')
          : '';
  return [
    workflowSourceIdentityKey(identity),
    operation,
    operationIdentity,
    attemptMarker,
  ].join('\u001f');
}

export function ticketPendingActionMatches(
  pending: WorkflowTicketPendingAction,
  run: TicketRunState,
  operation: TicketOperation,
): boolean {
  const stagedClaim =
    operation === 'claim' && !run.claim && Boolean(pending.claimId);
  if (
    CLAIM_REQUIRED_TICKET_OPERATIONS.has(operation) &&
    !run.claim &&
    !stagedClaim
  )
    return false;
  return (
    pending.operation === operation &&
    pending.sourceKind === run.source.kind &&
    pending.ticketRef === run.source.ref &&
    pending.runId === run.runId &&
    (operation !== 'select' ||
      (pending.selector?.kind === run.queueSelector?.kind &&
        pending.selector?.value === run.queueSelector?.value)) &&
    (operation !== 'repository-scope-approval' ||
      pending.repository === run.pendingScopeRequest?.repository) &&
    (operation === 'reclaim'
      ? pending.staleClaimId === run.claim?.id &&
        Boolean(pending.claimId) &&
        pending.claimId !== pending.staleClaimId
      : stagedClaim || pending.claimId === run.claim?.id)
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
    const matchingPending =
      pending?.executionSource === 'ticket' &&
      ticketPendingActionMatches(pending, state.ticketRun, operation)
        ? pending
        : undefined;
    const attemptMarker = matchingPending?.attemptMarker ?? 'attempt-0';
    return ticketAutoWorkflowActionKey(
      {
        source: 'ticket',
        sourceKind: state.ticketRun.source.kind,
        ticketRef: state.ticketRun.source.ref,
        runId: state.ticketRun.runId,
        ...(operation === 'reclaim'
          ? {
              staleClaimId: state.ticketRun.claim?.id,
              claimId: matchingPending?.claimId,
            }
          : operation === 'claim'
            ? { claimId: matchingPending?.claimId }
            : { claimId: state.ticketRun.claim?.id }),
        ...ticketOperationIdentityFromPrompt(
          prompt,
          state.ticketRun,
          operation,
        ),
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

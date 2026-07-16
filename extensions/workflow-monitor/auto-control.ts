import { randomUUID } from 'node:crypto';
import {
  AUTO_CONTROL_FIELDS,
  clearReviewControl,
  PROJECT_FALLBACK_CONTROL_FIELDS,
} from './workflow-state-control.ts';
import {
  ticketAutoWorkflowActionKey,
  ticketOperationFromPrompt,
  ticketOperationIdentityFromPrompt,
  ticketPendingActionMatches,
  ticketRefFromPrompt,
  ticketSelectorFromPrompt,
} from './auto-action-keys.ts';
import {
  taskIdentityKeyParts,
  type TicketSliceIdentity,
} from './workflow-task-identity.ts';
import type {
  AutoFreshReason,
  AutoPendingActionReason,
  WorkflowAutoPendingAction,
  WorkflowState,
} from './workflow-transitions.ts';

export type AutoControlTarget = {
  plan?: string;
  taskId?: string;
  sliceIndex?: number;
  taskIndex?: number;
  taskTitle?: string;
};

export { AUTO_CONTROL_FIELDS } from './workflow-state-control.ts';

export function hasLiveAutoControl(state: WorkflowState | undefined): boolean {
  return Boolean(
    state &&
    (state.autoMode ||
      (state.autoFreshPrompt && state.autoFreshReason) ||
      state.autoPendingAction),
  );
}

export function explicitlyStoppedAuto(state: WorkflowState): boolean {
  return Boolean(
    state.autoPausedReason === 'user-stopped' ||
    /^\/addy-auto\s+stop\b/.test(state.lastTrigger ?? ''),
  );
}

export function withProjectAutoControl(
  state: WorkflowState,
  projectState: WorkflowState | undefined,
): WorkflowState {
  if (!hasLiveAutoControl(projectState)) return state;
  if (state.autoMode || explicitlyStoppedAuto(state)) return state;

  const merged = { ...state, autoMode: Boolean(projectState?.autoMode) };
  for (const field of PROJECT_FALLBACK_CONTROL_FIELDS) {
    const value = projectState?.[field];
    if (value !== undefined) merged[field] = value as never;
  }
  return merged;
}

export function sanitizedProjectFallbackAutoControl(
  state: WorkflowState,
): WorkflowState {
  const validPendingFresh = Boolean(
    state.autoFreshPrompt && state.autoFreshReason,
  );
  const validPendingAction = Boolean(state.autoPendingAction);
  const autoPendingAction = Boolean(
    state.autoPendingAction &&
    state.autoPendingAction.executionSource !== 'ticket',
  );
  const preserveFreshRetry = Boolean(
    validPendingFresh &&
    state.autoRetryKey?.startsWith(`${state.autoFreshPrompt}`),
  );
  const sanitized = {
    ...state,
    autoMode: Boolean(state.autoMode || validPendingFresh || autoPendingAction),
  };

  if (!validPendingFresh && !validPendingAction && !state.autoMode) {
    for (const field of PROJECT_FALLBACK_CONTROL_FIELDS)
      sanitized[field] = undefined as never;
    return sanitized;
  }

  let next = clearReviewControl(sanitized);
  next = { ...next, autoLastPrompt: undefined };
  if (!preserveFreshRetry) {
    next.autoRetryKey = undefined;
    next.autoRetryCount = undefined;
  }
  return next;
}

export function autoFreshContinuationKey(
  prompt: string,
  reason: AutoFreshReason,
  state: WorkflowState,
): string {
  const pendingTicket =
    state.autoPendingAction?.executionSource === 'ticket'
      ? state.autoPendingAction
      : undefined;
  return [
    reason,
    prompt,
    state.activePlan ?? '',
    state.currentSliceIndex ?? '',
    state.currentTaskIndex ?? '',
    state.currentTask ?? '',
    state.autoReviewTask ?? '',
    state.autoReviewTaskIndex ?? '',
    state.autoRetryKey ?? '',
    state.autoRetryCount ?? '',
    state.executionSource === 'ticket'
      ? (state.ticketRun?.source.kind ?? pendingTicket?.sourceKind ?? '')
      : '',
    state.executionSource === 'ticket'
      ? (state.ticketRun?.source.ref ?? pendingTicket?.ticketRef ?? '')
      : '',
    state.executionSource === 'ticket'
      ? (state.ticketRun?.runId ?? pendingTicket?.runId ?? '')
      : '',
    state.executionSource === 'ticket'
      ? (state.ticketRun?.claim?.id ?? pendingTicket?.claimId ?? '')
      : '',
  ].join('\u001f');
}

export function validPendingFreshContinuation(
  state: WorkflowState,
): state is WorkflowState & {
  autoFreshPrompt: string;
  autoFreshReason: AutoFreshReason;
} {
  return Boolean(state.autoFreshPrompt && state.autoFreshReason);
}

export function pendingFreshContinuationKey(
  state: WorkflowState & {
    autoFreshPrompt: string;
    autoFreshReason: AutoFreshReason;
  },
): string {
  return (
    state.autoFreshDeliveryKey ??
    autoFreshContinuationKey(
      state.autoFreshPrompt,
      state.autoFreshReason,
      state,
    )
  );
}

export function pendingFreshContinuationKeyMatches(
  state: WorkflowState,
  key: string,
): state is WorkflowState & {
  autoFreshPrompt: string;
  autoFreshReason: AutoFreshReason;
} {
  return (
    validPendingFreshContinuation(state) &&
    pendingFreshContinuationKey(state) === key
  );
}

export function clearAutoFreshUpdates(
  state?: WorkflowState,
): Partial<WorkflowState> {
  return {
    autoFreshPrompt: undefined,
    autoFreshExpandedPrompt: undefined,
    autoFreshReason: undefined,
    autoFreshDeliveryKey: undefined,
    autoFreshConsumedKey:
      state?.autoFreshDeliveryKey ?? state?.autoFreshConsumedKey,
  };
}

export function staleAutoFreshUpdates(): Partial<WorkflowState> {
  return {
    autoFreshPrompt: undefined,
    autoFreshExpandedPrompt: undefined,
    autoFreshReason: undefined,
    autoFreshDeliveryKey: undefined,
  };
}

export function autoRetryKey(state: WorkflowState, prompt: string): string {
  const taskIdentity = taskIdentityKeyParts({
    taskId: state.currentTaskId,
    taskIndex: state.currentTaskIndex,
    taskTitle: state.currentTask,
  });
  return [
    prompt,
    state.activePlan ?? '',
    ...taskIdentity,
    state.nextTask ?? '',
  ].join('\u001f');
}

export function pendingAutoActionForPrompt(
  prompt: string,
  state: WorkflowState,
  target: AutoControlTarget | undefined,
  reason: AutoPendingActionReason,
  key: string,
  deliveryPrompt?: string,
): WorkflowAutoPendingAction {
  const details = {
    plan: target?.plan ?? state.activePlan,
    taskId: target?.taskId ?? state.autoReviewTaskId ?? state.currentTaskId,
    sliceIndex: target?.sliceIndex ?? state.currentSliceIndex,
    taskIndex:
      target?.taskIndex ?? state.autoReviewTaskIndex ?? state.currentTaskIndex,
    taskTitle: target?.taskTitle ?? state.autoReviewTask ?? state.currentTask,
  };
  const attempts = (state.autoPendingAction?.attempts ?? -1) + 1;
  if (state.executionSource === 'ticket' && !state.ticketRun) {
    const operation = ticketOperationFromPrompt(prompt);
    if (!operation || !['select', 'status', 'claim'].includes(operation))
      throw new Error('Cannot dispatch this Ticket operation without a run.');
    const selector = ticketSelectorFromPrompt(prompt);
    const ticketRef =
      operation === 'select' ? selector?.value : ticketRefFromPrompt(prompt);
    if (!ticketRef) throw new Error('Cannot identify the Ticket reference.');
    const previous = state.autoPendingAction;
    const sameAction =
      previous?.executionSource === 'ticket' &&
      previous.operation === operation &&
      previous.ticketRef === ticketRef &&
      previous.prompt === prompt;
    const runId = sameAction ? previous.runId : randomUUID();
    const claimId =
      operation === 'claim'
        ? sameAction && previous?.executionSource === 'ticket'
          ? previous.claimId
          : randomUUID()
        : undefined;
    const attemptMarker = sameAction
      ? previous.attemptMarker
      : `attempt-${attempts}`;
    const identity: TicketSliceIdentity = {
      source: 'ticket',
      ticketRef,
      runId,
      ...(claimId ? { claimId } : {}),
      ...(selector ? { selector } : {}),
    };
    return {
      executionSource: 'ticket',
      key: ticketAutoWorkflowActionKey(identity, operation, attemptMarker),
      prompt,
      ...(deliveryPrompt !== undefined
        ? { expandedPrompt: deliveryPrompt }
        : {}),
      ticketRef,
      runId,
      ...(claimId ? { claimId } : {}),
      ...(selector ? { selector } : {}),
      operation,
      attemptMarker,
      reason,
      attempts,
      createdAt: new Date().toISOString(),
    };
  }
  if (state.executionSource === 'ticket' && state.ticketRun) {
    const operation = ticketOperationFromPrompt(prompt);
    if (!operation)
      throw new Error(
        `Cannot identify Ticket operation for pending action: ${prompt}`,
      );
    if (operation === 'reclaim' && !state.ticketRun.claim)
      throw new Error('Cannot RECLAIM without a stale claim identity.');
    const operationIdentity = ticketOperationIdentityFromPrompt(
      prompt,
      state.ticketRun,
      operation,
    );
    const pending = state.autoPendingAction;
    const sameAction =
      pending?.executionSource === 'ticket' &&
      ticketPendingActionMatches(pending, state.ticketRun, operation) &&
      pending.selector?.kind === operationIdentity.selector?.kind &&
      pending.selector?.value === operationIdentity.selector?.value &&
      pending.repository === operationIdentity.repository;
    const identity: TicketSliceIdentity = {
      source: 'ticket' as const,
      sourceKind: state.ticketRun.source.kind,
      ticketRef: state.ticketRun.source.ref,
      runId: state.ticketRun.runId,
      ...(operation === 'reclaim'
        ? {
            staleClaimId: state.ticketRun.claim?.id,
            claimId:
              sameAction && pending.executionSource === 'ticket'
                ? pending.claimId
                : randomUUID(),
          }
        : operation === 'claim' && !state.ticketRun.claim
          ? {
              claimId:
                sameAction && pending.executionSource === 'ticket'
                  ? pending.claimId
                  : randomUUID(),
            }
          : { claimId: state.ticketRun.claim?.id }),
      ...operationIdentity,
    };
    const attemptMarker = sameAction
      ? pending.attemptMarker
      : `attempt-${attempts}`;
    return {
      executionSource: 'ticket',
      key: ticketAutoWorkflowActionKey(identity, operation, attemptMarker),
      prompt,
      ...(deliveryPrompt !== undefined
        ? { expandedPrompt: deliveryPrompt }
        : {}),
      sourceKind: identity.sourceKind,
      ticketRef: identity.ticketRef,
      runId: identity.runId,
      ...(identity.claimId ? { claimId: identity.claimId } : {}),
      ...(identity.staleClaimId ? { staleClaimId: identity.staleClaimId } : {}),
      ...(identity.selector ? { selector: identity.selector } : {}),
      ...(identity.repository ? { repository: identity.repository } : {}),
      operation,
      attemptMarker,
      reason,
      attempts,
      createdAt: new Date().toISOString(),
    };
  }
  return {
    key,
    prompt,
    expandedPrompt: deliveryPrompt,
    plan: details.plan,
    taskId: details.taskId,
    sliceIndex: details.sliceIndex,
    taskIndex: details.taskIndex,
    taskTitle: details.taskTitle,
    reason,
    attempts,
    createdAt: new Date().toISOString(),
  };
}

export function stateWithPendingAutoAction(
  state: WorkflowState,
  prompt: string,
  target: AutoControlTarget | undefined,
  reason: AutoPendingActionReason,
  key: string,
  deliveryPrompt?: string,
): WorkflowState {
  return {
    ...state,
    autoPendingAction: pendingAutoActionForPrompt(
      prompt,
      state,
      target,
      reason,
      key,
      deliveryPrompt,
    ),
  };
}

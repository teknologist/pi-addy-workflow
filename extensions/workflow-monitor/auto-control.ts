import {
  AUTO_CONTROL_FIELDS,
  clearReviewControl,
  PROJECT_FALLBACK_CONTROL_FIELDS,
} from './workflow-state-control.ts';
import {
  ticketAutoWorkflowActionKey,
  ticketOperationFromPrompt,
  ticketPendingActionMatches,
} from './auto-action-keys.ts';
import { taskIdentityKeyParts } from './workflow-task-identity.ts';
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

  const merged = { ...state, autoMode: true };
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
  const preserveFreshRetry = Boolean(
    validPendingFresh &&
    state.autoRetryKey?.startsWith(`${state.autoFreshPrompt}`),
  );
  const sanitized = {
    ...state,
    autoMode: Boolean(
      state.autoMode || validPendingFresh || validPendingAction,
    ),
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
      ? (state.ticketRun?.source.kind ?? '')
      : '',
    state.executionSource === 'ticket'
      ? (state.ticketRun?.source.ref ?? '')
      : '',
    state.executionSource === 'ticket' ? (state.ticketRun?.runId ?? '') : '',
    state.executionSource === 'ticket'
      ? (state.ticketRun?.claim?.id ?? '')
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
  if (state.executionSource === 'ticket' && state.ticketRun) {
    const operation = ticketOperationFromPrompt(prompt);
    if (!operation)
      throw new Error(
        `Cannot identify Ticket operation for pending action: ${prompt}`,
      );
    const identity = {
      source: 'ticket' as const,
      sourceKind: state.ticketRun.source.kind,
      ticketRef: state.ticketRun.source.ref,
      runId: state.ticketRun.runId,
      claimId: state.ticketRun.claim?.id,
    };
    const pending = state.autoPendingAction;
    const sameAction =
      pending?.executionSource === 'ticket' &&
      ticketPendingActionMatches(pending, state.ticketRun, operation);
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

import {
  AUTO_CONTROL_FIELDS,
  clearReviewControl,
  PROJECT_FALLBACK_CONTROL_FIELDS,
} from './workflow-state-control.ts';
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
    attempts: (state.autoPendingAction?.attempts ?? -1) + 1,
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

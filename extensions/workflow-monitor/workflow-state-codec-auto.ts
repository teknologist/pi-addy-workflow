import type {
  WorkflowAutoPendingAction,
  WorkflowTicketPendingAction,
} from './workflow-core.ts';
import {
  isTicketOperation,
  isTicketSourceKind,
} from './workflow-state-codec-ticket.ts';
import {
  isNonNegativeSafeInteger,
  isOptionalString,
  isPositiveSafeInteger,
} from './workflow-state-codec-primitives.ts';

export function isAutoPendingActionReason(
  value: unknown,
): value is WorkflowAutoPendingAction['reason'] {
  return (
    value === 'next-action' ||
    value === 'fresh-fallback' ||
    value === 'idle-retry' ||
    value === 'commit-frontier'
  );
}

export function coerceAutoPendingAction(
  value: unknown,
): WorkflowAutoPendingAction | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return undefined;

  const candidate = value as Partial<
    Omit<WorkflowTicketPendingAction, 'executionSource'>
  > & { executionSource?: 'plan' | 'ticket' };
  if (
    typeof candidate.key !== 'string' ||
    candidate.key.length === 0 ||
    typeof candidate.prompt !== 'string' ||
    candidate.prompt.length === 0 ||
    !isAutoPendingActionReason(candidate.reason) ||
    !isNonNegativeSafeInteger(candidate.attempts) ||
    typeof candidate.createdAt !== 'string'
  )
    return undefined;
  if (!isOptionalString(candidate.expandedPrompt)) return undefined;
  if (
    candidate.executionSource !== undefined &&
    candidate.executionSource !== 'plan' &&
    candidate.executionSource !== 'ticket'
  )
    return undefined;
  if (!isOptionalString(candidate.plan)) return undefined;
  if (!isOptionalString(candidate.taskId)) return undefined;
  if (
    candidate.taskIndex !== undefined &&
    !isPositiveSafeInteger(candidate.taskIndex)
  )
    return undefined;
  if (!isOptionalString(candidate.taskTitle)) return undefined;
  if (
    candidate.sliceIndex !== undefined &&
    !isPositiveSafeInteger(candidate.sliceIndex)
  )
    return undefined;

  const common = {
    key: candidate.key,
    prompt: candidate.prompt,
    ...(candidate.expandedPrompt !== undefined
      ? { expandedPrompt: candidate.expandedPrompt }
      : {}),
    reason: candidate.reason,
    attempts: candidate.attempts,
    createdAt: candidate.createdAt,
  };
  if (candidate.executionSource === 'ticket') {
    if (
      !isTicketSourceKind(candidate.sourceKind) ||
      !isOptionalString(candidate.claimId) ||
      typeof candidate.ticketRef !== 'string' ||
      candidate.ticketRef.length === 0 ||
      typeof candidate.runId !== 'string' ||
      candidate.runId.length === 0 ||
      !isTicketOperation(candidate.operation) ||
      typeof candidate.attemptMarker !== 'string' ||
      candidate.attemptMarker.length === 0 ||
      candidate.plan !== undefined ||
      candidate.taskId !== undefined ||
      candidate.taskIndex !== undefined ||
      candidate.taskTitle !== undefined ||
      candidate.sliceIndex !== undefined
    )
      return undefined;
    return {
      ...common,
      executionSource: 'ticket',
      sourceKind: candidate.sourceKind,
      ticketRef: candidate.ticketRef,
      runId: candidate.runId,
      ...(candidate.claimId !== undefined
        ? { claimId: candidate.claimId }
        : {}),
      operation: candidate.operation,
      attemptMarker: candidate.attemptMarker,
    };
  }

  return {
    ...common,
    ...(candidate.executionSource === 'plan'
      ? { executionSource: 'plan' as const }
      : {}),
    ...(candidate.plan !== undefined ? { plan: candidate.plan } : {}),
    ...(candidate.taskId !== undefined ? { taskId: candidate.taskId } : {}),
    ...(candidate.taskIndex !== undefined
      ? { taskIndex: candidate.taskIndex }
      : {}),
    ...(candidate.taskTitle !== undefined
      ? { taskTitle: candidate.taskTitle }
      : {}),
    ...(candidate.sliceIndex !== undefined
      ? { sliceIndex: candidate.sliceIndex }
      : {}),
  };
}

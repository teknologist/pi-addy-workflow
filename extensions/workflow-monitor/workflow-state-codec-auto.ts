import type { WorkflowAutoPendingAction } from './workflow-core.ts';
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

  const candidate = value as Partial<WorkflowAutoPendingAction>;
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

  return {
    key: candidate.key,
    prompt: candidate.prompt,
    expandedPrompt: candidate.expandedPrompt,
    plan: candidate.plan,
    taskId: candidate.taskId,
    taskIndex: candidate.taskIndex,
    taskTitle: candidate.taskTitle,
    sliceIndex: candidate.sliceIndex,
    reason: candidate.reason,
    attempts: candidate.attempts,
    createdAt: candidate.createdAt,
  };
}

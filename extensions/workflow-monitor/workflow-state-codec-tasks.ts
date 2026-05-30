import type { WorkflowState } from './workflow-core.ts';
import {
  isOptionalString,
  isPositiveSafeInteger,
} from './workflow-state-codec-primitives.ts';

type WorkflowTaskProgressFields = Pick<
  WorkflowState,
  | 'currentTask'
  | 'currentTaskId'
  | 'nextTask'
  | 'nextTaskId'
  | 'currentTaskIndex'
  | 'taskCount'
  | 'currentSliceIndex'
  | 'sliceCount'
  | 'currentTaskSummary'
  | 'nextTaskSummary'
>;

export function coerceWorkflowTaskProgress(
  candidate: Partial<WorkflowTaskProgressFields>,
): WorkflowTaskProgressFields | undefined {
  if (!isOptionalString(candidate.currentTask)) return undefined;
  if (!isOptionalString(candidate.currentTaskId)) return undefined;
  if (!isOptionalString(candidate.nextTask)) return undefined;
  if (!isOptionalString(candidate.nextTaskId)) return undefined;
  if (
    candidate.currentTaskIndex !== undefined &&
    !isPositiveSafeInteger(candidate.currentTaskIndex)
  )
    return undefined;
  if (
    candidate.taskCount !== undefined &&
    !isPositiveSafeInteger(candidate.taskCount)
  )
    return undefined;
  if (
    candidate.currentTaskIndex !== undefined &&
    candidate.taskCount !== undefined &&
    candidate.currentTaskIndex > candidate.taskCount
  )
    return undefined;
  if (
    candidate.currentSliceIndex !== undefined &&
    !isPositiveSafeInteger(candidate.currentSliceIndex)
  )
    return undefined;
  if (
    candidate.sliceCount !== undefined &&
    !isPositiveSafeInteger(candidate.sliceCount)
  )
    return undefined;
  if (
    candidate.currentSliceIndex !== undefined &&
    candidate.sliceCount !== undefined &&
    candidate.currentSliceIndex > candidate.sliceCount
  )
    return undefined;
  if (!isOptionalString(candidate.currentTaskSummary)) return undefined;
  if (!isOptionalString(candidate.nextTaskSummary)) return undefined;

  return {
    currentTask: candidate.currentTask,
    currentTaskId: candidate.currentTaskId,
    nextTask: candidate.nextTask,
    nextTaskId: candidate.nextTaskId,
    currentTaskIndex: candidate.currentTaskIndex,
    taskCount: candidate.taskCount,
    currentSliceIndex: candidate.currentSliceIndex,
    sliceCount: candidate.sliceCount,
    currentTaskSummary: candidate.currentTaskSummary,
    nextTaskSummary: candidate.nextTaskSummary,
  };
}

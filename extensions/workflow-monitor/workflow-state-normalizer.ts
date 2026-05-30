import { phaseIndex } from './workflow-phases.ts';
import type { WorkflowState } from './workflow-core.ts';
import { sanitizeWorkflowArtifacts } from './workflow-state-codec-metadata.ts';
import { normalizeWorkflowStats } from './workflow-stats.ts';

export function normalizeWorkflowState(state: WorkflowState): WorkflowState {
  const sanitizedState = sanitizeWorkflowArtifacts(state);
  const normalizedTasks =
    sanitizedState.currentTask || sanitizedState.nextTask
      ? {
          currentTask: sanitizedState.currentTask,
          currentTaskId: sanitizedState.currentTaskId,
          nextTask: sanitizedState.nextTask,
          nextTaskId: sanitizedState.nextTaskId,
          currentTaskIndex: sanitizedState.currentTaskIndex,
          taskCount: sanitizedState.taskCount,
          currentSliceIndex: sanitizedState.currentSliceIndex,
          sliceCount: sanitizedState.sliceCount,
          currentTaskSummary: sanitizedState.currentTaskSummary,
          nextTaskSummary: sanitizedState.nextTaskSummary,
        }
      : {};

  const normalizedStats = {
    stats: normalizeWorkflowStats(sanitizedState.stats),
  };

  if (
    !sanitizedState.current ||
    phaseIndex(sanitizedState.current) <= phaseIndex('plan')
  )
    return { ...sanitizedState, ...normalizedTasks, ...normalizedStats };

  return {
    ...sanitizedState,
    ...normalizedTasks,
    ...normalizedStats,
    phases: {
      ...sanitizedState.phases,
      define: 'complete',
      plan: 'complete',
    },
  };
}

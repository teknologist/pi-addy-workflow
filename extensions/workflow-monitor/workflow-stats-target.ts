import type { WorkflowStatsTarget } from './workflow-stats.ts';
import type { WorkflowState } from './workflow-transitions.ts';

export function statsTargetFromTask(
  task: NonNullable<WorkflowState['stats']>['active']['tasks'][string],
): WorkflowStatsTarget {
  return {
    plan: task.plan,
    taskId: task.taskId,
    sliceIndex: task.sliceIndex,
    taskIndex: task.taskIndex,
    taskTitle: task.taskTitle,
  };
}

export function latestActiveStatsTarget(
  state: WorkflowState,
): WorkflowStatsTarget | undefined {
  const task = Object.values(state.stats?.active.tasks ?? {}).at(-1);
  if (!task) return undefined;
  return statsTargetFromTask(task);
}

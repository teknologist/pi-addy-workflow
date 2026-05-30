import type { PlanTask } from './plan-task-lifecycle.ts';
import type { WorkflowTaskIdentity } from './workflow-task-identity.ts';

export type ResolvedPlanTaskTarget = {
  task: PlanTask;
  taskIndex: number;
};

export function resolvePlanTaskTarget(
  tasks: PlanTask[],
  target: WorkflowTaskIdentity,
): ResolvedPlanTaskTarget | undefined {
  const task = target.taskId
    ? tasks.find((candidate) => candidate.taskId === target.taskId)
    : target.taskIndex
      ? tasks[target.taskIndex - 1]
      : tasks.find((candidate) => candidate.title === target.taskTitle);
  if (!task) return undefined;
  return { task, taskIndex: tasks.indexOf(task) + 1 };
}

export function resolvedPlanTaskMatchesTarget(
  resolved: ResolvedPlanTaskTarget | undefined,
  target: WorkflowTaskIdentity,
): boolean {
  if (!resolved) return false;
  return target.taskId
    ? resolved.task.taskId === target.taskId
    : resolved.task.title === target.taskTitle;
}

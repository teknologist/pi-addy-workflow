import { readFileSync } from 'node:fs';
import { planTasksFromMarkdown, type PlanTask } from './plan-task-lifecycle.ts';
import {
  resolvePlanTaskTarget,
  resolvedPlanTaskMatchesTarget,
  type ResolvedPlanTaskTarget,
} from './plan-task-resolution.ts';
import type { WorkflowStatsTarget } from './workflow-stats.ts';
import { resolveWorkflowPlanPath } from './workflow-plan-path.ts';

export function readPlanTasks(
  planPath: string | undefined,
  baseCwd?: string,
): PlanTask[] | undefined {
  if (!planPath) return undefined;
  try {
    return planTasksFromMarkdown(
      readFileSync(resolveWorkflowPlanPath(planPath, baseCwd), 'utf8'),
    );
  } catch {
    return undefined;
  }
}

export function resolvePlanTaskTargetFromPlan(
  planPath: string | undefined,
  baseCwd: string | undefined,
  target: WorkflowStatsTarget | undefined,
): ResolvedPlanTaskTarget | undefined {
  if (!target || (!target.taskId && !target.taskTitle)) return undefined;
  const tasks = readPlanTasks(planPath, baseCwd);
  return tasks ? resolvePlanTaskTarget(tasks, target) : undefined;
}

export function planTaskTargetIsComplete(
  planPath: string | undefined,
  baseCwd: string | undefined,
  target: WorkflowStatsTarget,
): boolean {
  const resolved = resolvePlanTaskTargetFromPlan(planPath, baseCwd, target);
  return Boolean(
    resolved?.task.complete && resolvedPlanTaskMatchesTarget(resolved, target),
  );
}

export function targetWithResolvedPlanTask(
  target: WorkflowStatsTarget | undefined,
  baseCwd?: string,
): WorkflowStatsTarget | undefined {
  if (!target?.plan || (!target.taskId && !target.taskTitle)) return target;
  const resolved = resolvePlanTaskTargetFromPlan(target.plan, baseCwd, target);
  if (!resolved?.task.taskId) return target;
  if (
    !target.taskId &&
    target.taskTitle &&
    resolved.task.title !== target.taskTitle
  )
    return target;
  return {
    ...target,
    taskId: resolved.task.taskId,
    taskIndex: resolved.taskIndex,
    taskTitle: resolved.task.title,
  };
}

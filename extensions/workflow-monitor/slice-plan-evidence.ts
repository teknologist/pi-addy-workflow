import {
  taskMatchesPlanTask,
  type PlanTask,
  type PlanTaskStatus,
} from './plan-task-lifecycle.ts';
import { commandFromPrompt } from './command-router.ts';
import { addIssueStats, emptyIssueStats } from './workflow-stats.ts';
import type {
  WorkflowState,
  WorkflowTaskStats,
} from './workflow-transitions.ts';

function stateTargetsPlanTask(
  state: WorkflowState,
  task: PlanTask,
  index: number,
): boolean {
  return (
    taskMatchesPlanTask(task, index, {
      taskId: state.currentTaskId,
      taskIndex: state.currentTaskIndex,
      taskTitle: state.currentTask,
    }) ||
    taskMatchesPlanTask(task, index, {
      taskId: state.autoReviewTaskId,
      taskIndex: state.autoReviewTaskIndex,
      taskTitle: state.autoReviewTask,
    })
  );
}

function statsForPlanTask(
  state: WorkflowState,
  planPath: string,
  task: PlanTask,
  index: number,
): WorkflowTaskStats | undefined {
  const sessions = state.stats
    ? [state.stats.active, ...state.stats.history]
    : [];
  const tasks = sessions
    .flatMap((session) => Object.values(session.tasks))
    .filter(
      (candidate) =>
        (!candidate.plan || candidate.plan === planPath) &&
        taskMatchesPlanTask(task, index, candidate),
    );
  if (tasks.length === 0) return undefined;
  return tasks.reduce(
    (total, candidate) => ({
      ...candidate,
      turns: total.turns + candidate.turns,
      verifyRuns: total.verifyRuns + candidate.verifyRuns,
      reviewRuns: total.reviewRuns + candidate.reviewRuns,
      issues: addIssueStats(total.issues, candidate.issues),
    }),
    {
      turns: 0,
      verifyRuns: 0,
      reviewRuns: 0,
      issues: emptyIssueStats(),
    } as WorkflowTaskStats,
  );
}

function lifecycleEvidenceMissingStatuses(
  state: WorkflowState,
  planPath: string,
  task: PlanTask,
  index: number,
): PlanTaskStatus[] {
  if (!task.missingStatuses) return [];

  const stats = statsForPlanTask(state, planPath, task, index);
  const taskIsCurrentTarget = stateTargetsPlanTask(state, task, index);
  if (!taskIsCurrentTarget && !stats) return [];

  const command = commandFromPrompt(state.autoLastPrompt);
  const missing = new Set<PlanTaskStatus>();

  if (
    !task.missingStatuses.includes('Verified') &&
    (stats?.verifyRuns ?? 0) === 0 &&
    (stats || command === '/addy-build') &&
    command !== '/addy-verify' &&
    command !== '/addy-review'
  ) {
    missing.add('Verified');
  }

  if (
    !task.missingStatuses.includes('Reviewed') &&
    (stats?.reviewRuns ?? 0) === 0 &&
    !(taskIsCurrentTarget && command === '/addy-review')
  ) {
    missing.add('Reviewed');
  }

  return [...missing];
}

export function effectiveTaskMissingStatuses(
  state: WorkflowState,
  planPath: string,
  task: PlanTask,
  index: number,
): PlanTaskStatus[] | undefined {
  if (!task.missingStatuses) return undefined;
  return [
    ...task.missingStatuses,
    ...lifecycleEvidenceMissingStatuses(state, planPath, task, index),
  ].filter(
    (status, statusIndex, statuses) => statuses.indexOf(status) === statusIndex,
  );
}

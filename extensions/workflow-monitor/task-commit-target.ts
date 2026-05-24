import { targetWithResolvedPlanTask } from './plan-task-reader.ts';
import type { WorkflowStatsTarget } from './workflow-stats.ts';
import type { WorkflowState } from './workflow-transitions.ts';
import {
  nextWorkflowActionForActivePlanLifecycle,
  workflowTaskCommitKey,
} from './workflow-tracker.ts';

type WorkflowAction = ReturnType<
  typeof nextWorkflowActionForActivePlanLifecycle
>;

export function withPlanTaskId(
  target: WorkflowStatsTarget | undefined,
  baseCwd?: string,
): WorkflowStatsTarget | undefined {
  return targetWithResolvedPlanTask(target, baseCwd);
}

export function recordCommittedTask(
  state: WorkflowState,
  target: WorkflowStatsTarget | undefined,
  commitSha: string,
): WorkflowState {
  const plan = target?.plan ?? state.activePlan;
  const taskId = target?.taskId;
  const taskIndex = target?.taskIndex ?? state.currentTaskIndex;
  const taskTitle = target?.taskTitle ?? state.currentTask;
  if (!plan || !taskIndex || !taskTitle || taskTitle === 'none') return state;

  const key = workflowTaskCommitKey(plan, taskIndex, taskTitle, taskId);
  return {
    ...state,
    committedTasks: {
      ...state.committedTasks,
      [key]: {
        plan,
        ...(taskId ? { taskId } : {}),
        sliceIndex: target?.sliceIndex ?? state.currentSliceIndex,
        taskIndex,
        taskTitle,
        commitSha,
        committedAt: new Date().toISOString(),
      },
    },
  };
}

export function actionCommitTarget(
  state: WorkflowState,
  action: WorkflowAction,
): WorkflowStatsTarget | undefined {
  if (!action?.requiresCommit || !action.taskTitle) return undefined;
  return {
    plan: action.plan ?? state.activePlan,
    taskId: action.taskId,
    sliceIndex: action.currentSliceIndex ?? state.currentSliceIndex,
    taskIndex: action.taskIndex ?? state.currentTaskIndex,
    taskTitle: action.taskTitle,
  };
}

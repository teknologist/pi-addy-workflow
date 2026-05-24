import {
  planTasksFromMarkdown,
  taskIsClosed,
  type PlanTask,
} from './plan-task-lifecycle.ts';
import {
  currentSlicePlanPathFromIndex,
  readPlanMarkdown,
  sliceProgressForPlanPath,
  totalTaskProgressForSlice,
} from './slice-plan-series.ts';
import {
  nextWorkflowActionForActivePlanLifecycle,
  type WorkflowAction,
} from './slice-plan-action.ts';
import { stateForNextSlicePlan } from './workflow-plan-continuation.ts';
import type { WorkflowState } from './workflow-transitions.ts';

type WorkflowTasksSnapshot = {
  state: WorkflowState;
  tasks: PlanTask[];
  planRead: boolean;
};

function readWorkflowTasksSnapshot(
  state: WorkflowState,
  baseCwd?: string,
): WorkflowTasksSnapshot {
  if (!state.activePlan) return { state, tasks: [], planRead: false };

  const sliceProgress = sliceProgressForPlanPath(state.activePlan, baseCwd);

  const markdown = readPlanMarkdown(state.activePlan, baseCwd);
  if (!markdown) return { state, tasks: [], planRead: false };

  const tasks = planTasksFromMarkdown(markdown);
  if (tasks.length === 0) {
    const slicePlan = currentSlicePlanPathFromIndex(
      state.activePlan,
      markdown,
      baseCwd,
      state,
    );
    if (slicePlan && slicePlan !== state.activePlan)
      return readWorkflowTasksSnapshot(
        stateForNextSlicePlan(state, slicePlan),
        baseCwd,
      );

    return {
      state: {
        ...state,
        currentTask: undefined,
        currentTaskId: undefined,
        nextTask: undefined,
        nextTaskId: undefined,
        currentTaskIndex: undefined,
        taskCount: undefined,
        currentSliceIndex: sliceProgress?.currentSliceIndex,
        sliceCount: sliceProgress?.sliceCount,
        currentTaskSummary: undefined,
        nextTaskSummary: undefined,
      },
      tasks,
      planRead: true,
    };
  }

  const currentIndex = tasks.findIndex(
    (task, index) =>
      !taskIsClosed(state.committedTasks, state.activePlan!, task, index),
  );
  if (currentIndex === -1) {
    const currentTask = 'all tasks complete';
    const nextTask = 'none';
    return {
      state: {
        ...state,
        currentTask,
        currentTaskId: undefined,
        nextTask,
        nextTaskId: undefined,
        currentTaskIndex: tasks.length,
        taskCount: tasks.length,
        currentSliceIndex: sliceProgress?.currentSliceIndex,
        sliceCount: sliceProgress?.sliceCount,
        currentTaskSummary:
          state.currentTask === currentTask
            ? state.currentTaskSummary
            : undefined,
        nextTaskSummary:
          state.nextTask === nextTask ? state.nextTaskSummary : undefined,
      },
      tasks,
      planRead: true,
    };
  }

  const current = tasks[currentIndex];
  const next = tasks
    .slice(currentIndex + 1)
    .find(
      (task, offset) =>
        !taskIsClosed(
          state.committedTasks,
          state.activePlan!,
          task,
          currentIndex + 1 + offset,
        ),
    );
  const currentTask = current.title;
  const currentTaskId = current.taskId;
  const nextTask = next?.title ?? 'none';
  const nextTaskId = next?.taskId;
  return {
    state: {
      ...state,
      currentTask,
      currentTaskId,
      nextTask,
      nextTaskId,
      currentTaskIndex: currentIndex + 1,
      taskCount: tasks.length,
      currentSliceIndex: sliceProgress?.currentSliceIndex,
      sliceCount: sliceProgress?.sliceCount,
      currentTaskSummary:
        state.currentTask === currentTask
          ? state.currentTaskSummary
          : undefined,
      nextTaskSummary:
        state.nextTask === nextTask ? state.nextTaskSummary : undefined,
    },
    tasks,
    planRead: true,
  };
}

export function refreshWorkflowTasksFromPlan(
  state: WorkflowState,
  baseCwd?: string,
): WorkflowState {
  return readWorkflowTasksSnapshot(state, baseCwd).state;
}

export type SlicePlanProgress = {
  activePlan: string;
  hasTasks: boolean;
  allTasksClosed: boolean;
  currentTask?: string;
  currentTaskId?: string;
  nextTask?: string;
  nextTaskId?: string;
  currentTaskIndex?: number;
  taskCount?: number;
  currentSliceIndex?: number;
  sliceCount?: number;
  totalTaskProgress?: { currentTaskIndex: number; taskCount: number };
  action?: WorkflowAction;
};

export function readSlicePlanProgress(
  state: WorkflowState,
  baseCwd?: string,
): SlicePlanProgress | undefined {
  const snapshot = readWorkflowTasksSnapshot(state, baseCwd);
  const refreshed = snapshot.state;
  if (!refreshed.activePlan) return undefined;

  const tasks = snapshot.tasks;
  const hasTasks = snapshot.planRead && tasks.length > 0;
  const allTasksClosed = Boolean(
    hasTasks && refreshed.currentTask === 'all tasks complete',
  );

  return {
    activePlan: refreshed.activePlan,
    hasTasks,
    allTasksClosed,
    currentTask: refreshed.currentTask,
    currentTaskId: refreshed.currentTaskId,
    nextTask: refreshed.nextTask,
    nextTaskId: refreshed.nextTaskId,
    currentTaskIndex: refreshed.currentTaskIndex,
    taskCount: refreshed.taskCount,
    currentSliceIndex: refreshed.currentSliceIndex,
    sliceCount: refreshed.sliceCount,
    totalTaskProgress: totalTaskProgressForSlice(
      refreshed.activePlan,
      refreshed.currentTaskIndex,
      baseCwd,
    ),
    action: nextWorkflowActionForActivePlanLifecycle(refreshed, baseCwd),
  };
}

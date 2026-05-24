import {
  commandForWorkflowPhase,
  commandFromPrompt,
} from './command-router.ts';
import {
  planTaskFrontier,
  planTasksFromMarkdown,
  taskIsClosed,
  taskMatchesPlanTask,
  type PlanTask,
  type PlanTaskStatus,
} from './plan-task-lifecycle.ts';
import {
  currentSlicePlanPathFromIndex,
  nextUnfinishedSlicePlanPath,
  readPlanMarkdown,
  sliceProgressForPlanPath,
  totalTaskProgressForSlice,
} from './slice-plan-series.ts';
import { stateForNextSlicePlan } from './workflow-plan-continuation.ts';
import { addIssueStats, emptyIssueStats } from './workflow-stats.ts';
import {
  type WorkflowPhase,
  type WorkflowState,
  type WorkflowTaskStats,
} from './workflow-transitions.ts';

export {
  planTasksFromMarkdown,
  workflowTaskCommitKey,
} from './plan-task-lifecycle.ts';

export {
  isValidProgress,
  nextUnfinishedSlicePlanPath,
  totalTaskProgressForSlice,
} from './slice-plan-series.ts';

export const ADDY_AUTO_TASK_COMMIT_PROMPT = '__addy-auto-task-commit__';

function definedWorkflowActionFields(fields: {
  prompt: string;
  plan?: string;
  taskTitle?: string;
  taskId?: string;
  taskIndex?: number;
  currentSliceIndex?: number;
  missingStatuses?: PlanTaskStatus[];
  requiresCommit?: boolean;
}) {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  ) as typeof fields;
}

export function allTasksInCurrentPlanAreClosed(
  state: WorkflowState,
  baseCwd?: string,
): boolean {
  if (!state.activePlan) return false;
  const markdown = readPlanMarkdown(state.activePlan, baseCwd);
  if (!markdown) return false;
  const tasks = planTasksFromMarkdown(markdown);
  return (
    tasks.length > 0 &&
    tasks.every((task, index) =>
      taskIsClosed(state.committedTasks, state.activePlan!, task, index),
    )
  );
}

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

function effectiveTaskMissingStatuses(
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

export function unfinishedLifecycleStepsFromMarkdown(
  markdown: string,
): Array<{ title: string; missingStatuses: PlanTaskStatus[] }> {
  return planTasksFromMarkdown(markdown)
    .map((task) => ({
      title: task.title,
      allMissingStatuses: task.missingStatuses ?? [],
    }))
    .filter((task) => !task.allMissingStatuses.includes('Implemented'))
    .map((task) => ({
      title: task.title,
      missingStatuses: task.allMissingStatuses.filter(
        (status) => status !== 'Implemented',
      ),
    }))
    .filter((task) => task.missingStatuses.length > 0);
}

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
export function nextPromptForPhase(
  phase: WorkflowPhase,
  artifact?: string,
): string {
  return artifact
    ? `${commandForWorkflowPhase(phase)} ${artifact}`
    : commandForWorkflowPhase(phase);
}

export function nextPromptForActivePlanLifecycle(
  state: WorkflowState,
  baseCwd?: string,
): string | undefined {
  return nextWorkflowActionForActivePlanLifecycle(state, baseCwd)?.prompt;
}

export function nextWorkflowActionForActivePlanLifecycle(
  state: WorkflowState,
  baseCwd?: string,
):
  | {
      prompt: string;
      plan?: string;
      taskTitle?: string;
      taskId?: string;
      taskIndex?: number;
      currentSliceIndex?: number;
      missingStatuses?: PlanTaskStatus[];
      requiresCommit?: boolean;
    }
  | undefined {
  if (!state.activePlan) return undefined;

  const markdown = readPlanMarkdown(state.activePlan, baseCwd);
  if (!markdown)
    return { prompt: nextPromptForPhase('build', state.activePlan) };

  const tasks = planTasksFromMarkdown(markdown);
  if (tasks.length === 0) {
    const slicePlan = currentSlicePlanPathFromIndex(
      state.activePlan,
      markdown,
      baseCwd,
      state,
    );
    if (slicePlan && slicePlan !== state.activePlan)
      return nextWorkflowActionForActivePlanLifecycle(
        {
          ...state,
          activePlan: slicePlan,
          activeSuitePlan: state.activeSuitePlan ?? state.activePlan,
        },
        baseCwd,
      );
  }

  const task = planTaskFrontier({
    committedTasks: state.committedTasks,
    planPath: state.activePlan,
    tasks,
    effectiveMissingStatuses: (candidate, index) =>
      effectiveTaskMissingStatuses(state, state.activePlan!, candidate, index),
  });
  if (!task)
    return {
      prompt:
        tasks.length > 0
          ? nextPromptForPhase('finish', state.activePlan)
          : nextPromptForPhase('build', state.activePlan),
    };

  const missingStatuses = task.missingStatuses ?? ['Implemented'];
  const currentSliceIndex = sliceProgressForPlanPath(
    state.activePlan,
    baseCwd,
  )?.currentSliceIndex;
  const taskFields = {
    plan: state.activePlan,
    taskId: task.taskId,
    taskTitle: task.title,
    taskIndex: task.taskIndex,
    currentSliceIndex,
    missingStatuses,
  };
  if (missingStatuses.includes('Implemented'))
    return definedWorkflowActionFields({
      prompt: nextPromptForPhase('build', state.activePlan),
      ...taskFields,
    });
  if (missingStatuses.includes('Verified'))
    return definedWorkflowActionFields({
      prompt: nextPromptForPhase('verify', state.activePlan),
      ...taskFields,
    });
  if (missingStatuses.includes('Reviewed'))
    return definedWorkflowActionFields({
      prompt: nextPromptForPhase('review', state.activePlan),
      ...taskFields,
    });

  if (task.requiresCommit)
    return definedWorkflowActionFields({
      prompt: ADDY_AUTO_TASK_COMMIT_PROMPT,
      ...taskFields,
      requiresCommit: true,
    });

  return definedWorkflowActionFields({
    prompt: nextPromptForPhase('build', state.activePlan),
    ...taskFields,
  });
}

export type WorkflowAction = ReturnType<
  typeof nextWorkflowActionForActivePlanLifecycle
>;

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

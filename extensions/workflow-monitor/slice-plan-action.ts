import { commandForWorkflowPhase } from './command-router.ts';
import {
  planTaskFrontier,
  planTasksFromMarkdown,
  taskIsClosed,
  type PlanTaskStatus,
} from './plan-task-lifecycle.ts';
import { effectiveTaskMissingStatuses } from './slice-plan-evidence.ts';
import {
  currentSlicePlanPathFromIndex,
  readPlanMarkdown,
  sliceProgressForPlanPath,
} from './slice-plan-series.ts';
import type { WorkflowPhase, WorkflowState } from './workflow-transitions.ts';

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

import { readFileSync } from 'node:fs';
import { commandFromPrompt } from './command-router.ts';
import { expandPackagedPromptTemplate } from './prompt-template.ts';
import {
  resolvePlanTaskTarget,
  resolvedPlanTaskMatchesTarget,
} from './plan-task-resolution.ts';
import { resolveWorkflowPlanPath } from './workflow-plan-path.ts';
import { statsTargetFromTask } from './workflow-stats-target.ts';
import type { WorkflowStatsTarget } from './workflow-stats.ts';
import { stateForNextSlicePlan } from './workflow-plan-continuation.ts';
import type { WorkflowState } from './workflow-transitions.ts';
import {
  allTasksInCurrentPlanAreClosed,
  nextPromptForPhase,
  nextUnfinishedSlicePlanPath,
  nextWorkflowActionForActivePlanLifecycle,
  planTasksFromMarkdown,
} from './workflow-tracker.ts';

export type WorkflowAction = ReturnType<
  typeof nextWorkflowActionForActivePlanLifecycle
>;

export function reviewedTaskWasCompleted(
  previousState: WorkflowState,
  state: WorkflowState,
): boolean {
  if (!previousState.activePlan || !state.activePlan) return false;
  if (
    !previousState.currentTask ||
    previousState.currentTask === 'none' ||
    previousState.currentTask === 'all tasks complete'
  )
    return false;
  if (!previousState.currentTaskIndex || !previousState.taskCount) return false;

  return (
    state.activePlan !== previousState.activePlan ||
    state.currentTask !== previousState.currentTask ||
    state.currentTaskIndex !== previousState.currentTaskIndex ||
    state.taskCount !== previousState.taskCount
  );
}

export { statsTargetFromTask } from './workflow-stats-target.ts';

export function planTaskIsComplete(
  planPath: string | undefined,
  baseCwd: string | undefined,
  target: WorkflowStatsTarget,
): boolean {
  if (!planPath || (!target.taskTitle && !target.taskId)) return false;

  try {
    const tasks = planTasksFromMarkdown(
      readFileSync(resolveWorkflowPlanPath(planPath, baseCwd), 'utf8'),
    );
    const resolved = resolvePlanTaskTarget(tasks, target);
    return Boolean(
      resolved?.task.complete &&
      resolvedPlanTaskMatchesTarget(resolved, target),
    );
  } catch {
    return false;
  }
}

export function actionTargetsCompletePlanTask(
  state: WorkflowState,
  action: WorkflowAction,
  baseCwd?: string,
): boolean {
  if (!action?.taskTitle) return false;
  return planTaskIsComplete(state.activePlan, baseCwd, {
    taskIndex:
      state.currentTask === action.taskTitle
        ? state.currentTaskIndex
        : undefined,
    taskTitle: action.taskTitle,
    taskId: action.taskId,
  });
}

export function completedPlanAutoContinuation(
  state: WorkflowState,
  action: WorkflowAction,
  baseCwd?: string,
):
  | {
      state: WorkflowState;
      action: WorkflowAction;
    }
  | undefined {
  const command = commandFromPrompt(action?.prompt);
  if (command !== '/addy-review' && command !== '/addy-finish')
    return undefined;
  if (!allTasksInCurrentPlanAreClosed(state, baseCwd)) return undefined;

  const nextSlicePlan = nextUnfinishedSlicePlanPath(state, baseCwd);
  if (!nextSlicePlan && command === '/addy-review')
    return {
      state,
      action: {
        prompt: nextPromptForPhase('finish', state.activePlan),
        taskTitle: action?.taskTitle,
        missingStatuses: [],
      },
    };
  if (!nextSlicePlan) return undefined;

  const nextState = stateForNextSlicePlan(state, nextSlicePlan, {
    clearReviewTarget: true,
  });
  return {
    state: nextState,
    action: nextWorkflowActionForActivePlanLifecycle(nextState, baseCwd),
  };
}

export function latestCompletedActiveStatsTarget(
  state: WorkflowState,
  baseCwd?: string,
): WorkflowStatsTarget | undefined {
  const tasks = Object.values(state.stats?.active.tasks ?? {});
  for (const task of [...tasks].reverse()) {
    if (
      !task.taskTitle ||
      task.taskTitle === 'none' ||
      task.taskTitle === 'all tasks complete'
    )
      continue;
    const target = statsTargetFromTask(task);
    if (
      task.verifyRuns > 0 &&
      task.reviewRuns > 0 &&
      planTaskIsComplete(target.plan ?? state.activePlan, baseCwd, target)
    )
      return target;
  }
  return undefined;
}

export function autoPauseWarning(
  prompt: string,
  action: WorkflowAction,
): string {
  const missing = action?.missingStatuses?.join(', ');
  const task = action?.taskTitle ? ` Task: ${action.taskTitle}.` : '';
  const missingText = missing ? ` Missing: ${missing}.` : '';
  return `Addy auto paused at ${prompt}; the current lifecycle step is still incomplete after retry.${task}${missingText} Re-run the step after fixing the work, or update the plan checkbox only if that phase is actually complete.`;
}

export function autoRecoveryPrompt(
  prompt: string,
  action: WorkflowAction,
  retryCount: number,
): string {
  const task = action?.taskTitle ?? 'the current task';
  const missing = action?.missingStatuses?.join(', ') ?? 'the current phase';
  return `${expandPackagedPromptTemplate(prompt)}

## Addy Auto Same-Phase Recovery Pass

This is autonomous retry #${retryCount + 1} for the same incomplete lifecycle phase. Do not stop after a preflight/status report. Grind until the phase is complete or you can prove a hard blocker needs user input.

Target task: ${task}
Missing lifecycle evidence: ${missing}

Required loop:
1. Re-read the plan and the current task acceptance criteria.
2. Self-assess what is still missing for this exact phase.
3. Diagnose the blocker using focused commands and existing tests.
4. Make the smallest safe fix needed for this phase.
5. Run focused verification proving the fix.
6. Update only the lifecycle checkbox(es) backed by evidence from this turn.
7. If verification fails, iterate again in this same turn instead of pausing.

Pause only for a real hard blocker: missing credentials, destructive production risk, unresolved merge conflict, or explicit user decision required. If you pause, name the blocker and the exact command/evidence that proves it.`;
}

export function stateWithCompletedLifecyclePhasesFromPlan(
  state: WorkflowState,
  action: WorkflowAction,
): WorkflowState {
  const command = commandFromPrompt(action?.prompt);
  const missingStatuses = action?.missingStatuses;
  const phases = { ...state.phases };

  if (command === '/addy-finish') {
    phases.build = 'complete';
    phases.verify = 'complete';
    phases.review = 'complete';
  } else {
    if (missingStatuses && !missingStatuses.includes('Implemented'))
      phases.build = 'complete';
    if (missingStatuses && !missingStatuses.includes('Verified'))
      phases.verify = 'complete';
  }

  return { ...state, phases };
}

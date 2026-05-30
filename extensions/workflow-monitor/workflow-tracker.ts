import {
  phaseIndex,
  type WorkflowPhase,
  type WorkflowState,
} from './workflow-transitions.ts';

export {
  renderWorkflowStatsMarkdown,
  renderWorkflowStatsText,
} from './workflow-stats-report.ts';

export {
  ADDY_AUTO_TASK_COMMIT_PROMPT,
  allTasksInCurrentPlanAreClosed,
  nextPromptForActivePlanLifecycle,
  nextPromptForPhase,
  nextUnfinishedSlicePlanPath,
  nextWorkflowActionForActivePlanLifecycle,
  planTasksFromMarkdown,
  readSlicePlanProgress,
  refreshWorkflowTasksFromPlan,
  totalTaskProgressForSlice,
  unfinishedLifecycleStepsFromMarkdown,
  workflowTaskCommitKey,
  type SlicePlanProgress,
  type WorkflowAction,
} from './slice-plan-progress.ts';

export {
  WORKFLOW_WIDGET_KEY,
  renderWorkflowStrip,
  renderWorkflowWidget,
  workflowArtifactForFooter,
  workflowArtifactName,
  workflowTaskFooterLine,
} from './workflow-widget-presenter.ts';

export function promptArtifactForPhase(
  state: WorkflowState,
  phase: WorkflowPhase,
): string | undefined {
  if (phase === 'plan') return state.activeSpec;
  if (phaseIndex(phase) > phaseIndex('plan')) return state.activePlan;
  return undefined;
}

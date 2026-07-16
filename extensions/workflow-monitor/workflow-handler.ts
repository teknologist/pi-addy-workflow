import {
  createInitialWorkflowState,
  transitionWorkflow,
  type WorkflowEvent,
  type WorkflowPhase,
  type WorkflowState,
} from './workflow-transitions.ts';
import {
  nextPromptForPhase,
  promptArtifactForPhase,
  refreshWorkflowTasksFromPlan,
} from './workflow-tracker.ts';
import { scheduleWorkflowTaskSummary } from './workflow-task-summary.ts';
import {
  type AppendEntry,
  getContextWorkflowState,
  setContextWorkflowState,
  type WorkflowContext,
  workflowStateStore,
} from './workflow-state-store.ts';
import {
  archiveWorkflowStats,
  recordManualTaskTurn,
  type WorkflowStatsTarget,
} from './workflow-stats.ts';
import {
  ticketClaimSafetyWarning,
  ticketStateBlocksReset,
} from './ticket-source-switch.ts';

export { summarizeWorkflowTasks } from './workflow-task-summary.ts';

export function handleWorkflowEvent(
  ctx: WorkflowContext,
  event: WorkflowEvent,
  appendEntry?: AppendEntry,
): WorkflowState {
  const previous = getContextWorkflowState(ctx);
  const transitioned = transitionWorkflow(previous, event);
  const refreshed =
    transitioned.executionSource === 'ticket'
      ? transitioned
      : refreshWorkflowTasksFromPlan(transitioned, ctx.cwd);
  const next = recordManualTaskTurn(previous, refreshed, event);
  setContextWorkflowState(ctx, next, appendEntry);
  scheduleWorkflowTaskSummary(ctx, next, appendEntry);
  return ctx.state ?? next;
}

export function initializeWorkflowWidget(ctx: WorkflowContext): WorkflowState {
  const state = getContextWorkflowState(ctx);
  setContextWorkflowState(ctx, state);
  return ctx.state ?? state;
}

export function resetWorkflow(
  ctx: WorkflowContext,
  appendEntry?: AppendEntry,
): WorkflowState {
  const previous = getContextWorkflowState(ctx);
  if (ticketStateBlocksReset(previous)) {
    ctx.ui?.notify?.(
      ticketClaimSafetyWarning(previous, '/addy-workflow-reset')!,
      'warning',
    );
    return previous;
  }
  const state = {
    ...createInitialWorkflowState(),
    stats: archiveWorkflowStats(previous, 'reset').stats,
  };
  return workflowStateStore.reset(ctx, state, appendEntry);
}

export function openNextWorkflowPrompt(
  ctx: WorkflowContext,
  phase: WorkflowPhase,
  artifact?: string,
): string {
  const prompt = nextPromptForPhase(
    phase,
    artifact ?? promptArtifactForPhase(getContextWorkflowState(ctx), phase),
  );
  ctx.input?.prefill?.(prompt);
  return prompt;
}

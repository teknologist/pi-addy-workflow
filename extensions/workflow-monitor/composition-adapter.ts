import {
  ensureGlobalAddyWorkflowConfig,
  loadAddyWorkflowConfig,
  type AddyWorkflowConfig,
} from './config.ts';
import {
  handleWorkflowEvent,
  initializeWorkflowWidget,
  openNextWorkflowPrompt,
  resetWorkflow,
} from './workflow-handler.ts';
import {
  getContextWorkflowState,
  getProjectWorkflowState,
  setContextWorkflowState,
  type AppendEntry,
} from './workflow-state-store.ts';
import type {
  WorkflowEvent,
  WorkflowPhase,
  WorkflowState,
} from './workflow-transitions.ts';

type HostContext = {
  cwd?: string;
  ui?: { notify?: (message: string, level?: string) => void };
};

export function hostContext(ctx: unknown): HostContext {
  return ctx as HostContext;
}

export function baseCwd(ctx: unknown): string | undefined {
  return hostContext(ctx).cwd;
}

export function getWorkflowStateFromContext(ctx: unknown): WorkflowState {
  return getContextWorkflowState(ctx as never);
}

export function getProjectWorkflowStateFromContext(
  ctx: unknown,
  options?: { preferStored?: boolean },
): WorkflowState | undefined {
  return getProjectWorkflowState(ctx as never, options);
}

export function setWorkflowStateFromContext(
  ctx: unknown,
  state: WorkflowState,
  appendEntry?: Parameters<typeof setContextWorkflowState>[2],
): void {
  setContextWorkflowState(ctx as never, state, appendEntry);
}

export function loadWorkflowConfig(ctx: unknown): AddyWorkflowConfig {
  return loadAddyWorkflowConfig(hostContext(ctx));
}

export function freshContextConfig(
  ctx: unknown,
): AddyWorkflowConfig['auto']['freshContext'] {
  return loadWorkflowConfig(ctx).auto.freshContext;
}

export function shouldFreshContextBeforeEveryStep(ctx: unknown): boolean {
  return freshContextConfig(ctx).beforeEveryStep;
}

export function maxReviewFixLoops(ctx: unknown): number {
  return loadWorkflowConfig(ctx).auto.review.maxFixLoops;
}

export function ensureWorkflowConfig(ctx: unknown): void {
  ensureGlobalAddyWorkflowConfig(hostContext(ctx));
}

export function initializeWorkflowWidgetFromContext(
  ctx: unknown,
): WorkflowState {
  return initializeWorkflowWidget(ctx as never);
}

export function handleWorkflowEventFromContext(
  ctx: unknown,
  event: WorkflowEvent,
  appendEntry?: AppendEntry,
): void {
  handleWorkflowEvent(ctx as never, event, appendEntry);
}

export function openNextWorkflowPromptFromContext(
  ctx: unknown,
  phase: WorkflowPhase,
  artifact?: string,
): void {
  openNextWorkflowPrompt(ctx as never, phase, artifact);
}

export function resetWorkflowFromContext(
  ctx: unknown,
  appendEntry?: AppendEntry,
): void {
  resetWorkflow(ctx as never, appendEntry);
}

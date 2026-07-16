import {
  createInitialWorkflowState,
  parseWorkflowState,
  workflowStateFromEntry,
  type WorkflowStateEntry,
  type WorkflowState,
} from './workflow-state.ts';
import { refreshWorkflowTasksFromPlan } from './workflow-tracker.ts';
import {
  projectWorkflowStateKey,
  workflowStateKey,
} from './workflow-state-store-scope.ts';
import {
  readStoredWorkflowState,
  writeStoredWorkflowState,
} from './workflow-state-store-persistence.ts';
import {
  resolveWorkflowStateWithProjectControl,
  sanitizedProjectFallbackWorkflowState,
} from './workflow-state-store-project-control.ts';
import { readWorkflowMemoryState } from './workflow-state-memory-store.ts';
import {
  applyWorkflowStateUiEffects,
  clearWorkflowStateWidget,
} from './workflow-state-store-effects.ts';
import {
  commitWorkflowState,
  type AppendEntry,
} from './workflow-state-store-commit.ts';

export type { AppendEntry } from './workflow-state-store-commit.ts';

export type WorkflowContext = {
  cwd?: string;
  sessionId?: string;
  conversationId?: string;
  id?: string;
  ui?: {
    setWidget?: (key: string, value: unknown) => void;
    notify?: (message: string, level?: string) => void;
  };
  input?: {
    prefill?: (text: string) => void;
  };
  model?: unknown;
  modelRegistry?: {
    getApiKeyAndHeaders?: (model: unknown) => Promise<{
      ok: boolean;
      apiKey?: string;
      headers?: Record<string, string>;
      error?: string;
    }>;
  };
  signal?: AbortSignal;
  sessionManager?: {
    getBranch?: () => WorkflowStateEntry[];
  };
  state?: WorkflowState;
};

function projectFallbackWorkflowState(
  key: string,
  ctx: WorkflowContext,
): WorkflowState | undefined {
  return sanitizedProjectFallbackWorkflowState(
    getProjectWorkflowStateByKey(key, ctx),
  );
}

function getProjectWorkflowStateByKey(
  key: string,
  ctx: WorkflowContext,
  options?: { preferStored?: boolean },
): WorkflowState | undefined {
  const stored = readStoredWorkflowState(key, ctx);
  if (options?.preferStored) return stored ?? readWorkflowMemoryState(key);
  return readWorkflowMemoryState(key) ?? stored;
}

export function getProjectWorkflowState(
  ctx: WorkflowContext,
  options?: { preferStored?: boolean },
): WorkflowState | undefined {
  return getProjectWorkflowStateByKey(
    projectWorkflowStateKey(ctx),
    ctx,
    options,
  );
}

export function getContextWorkflowState(ctx: WorkflowContext): WorkflowState {
  const entries = ctx.sessionManager?.getBranch?.() ?? [];
  const key = workflowStateKey(ctx);
  const projectKey = projectWorkflowStateKey(ctx);
  const projectState =
    readWorkflowMemoryState(projectKey) ??
    readStoredWorkflowState(projectKey, ctx);
  const stateIfNotStalePending = (state: WorkflowState): WorkflowState =>
    resolveWorkflowStateWithProjectControl(state, projectState);

  for (const entry of [...entries].reverse()) {
    const state = workflowStateFromEntry(entry);
    if (state) return stateIfNotStalePending(state);
  }

  if (ctx.state) return stateIfNotStalePending(parseWorkflowState(ctx.state));

  return (
    readWorkflowMemoryState(key) ??
    readStoredWorkflowState(key, ctx) ??
    projectFallbackWorkflowState(projectKey, ctx) ??
    createInitialWorkflowState()
  );
}

export function setContextWorkflowState(
  ctx: WorkflowContext,
  state: WorkflowState,
  appendEntry?: AppendEntry,
): void {
  if (state.executionSource !== 'ticket')
    state = refreshWorkflowTasksFromPlan(state, ctx.cwd);
  commitWorkflowState(ctx, state, appendEntry);
  applyWorkflowStateUiEffects(ctx, state);
}

function resetWorkflowState(
  ctx: WorkflowContext,
  state: WorkflowState,
  appendEntry?: AppendEntry,
): WorkflowState {
  commitWorkflowState(ctx, state, appendEntry);
  clearWorkflowStateWidget(ctx);
  return state;
}

export const workflowStateStore = {
  get: getContextWorkflowState,
  set: setContextWorkflowState,
  reset: resetWorkflowState,
};

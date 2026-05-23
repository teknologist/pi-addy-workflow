import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  sanitizedProjectFallbackAutoControl,
  withProjectAutoControl,
} from './auto-control.ts';
import {
  WORKFLOW_STATE_ENTRY_TYPE,
  parsePersistedWorkflowState,
  parseWorkflowState,
  workflowStateFromEntry,
  type WorkflowStateEntry,
} from './workflow-state-codec.ts';
import {
  createInitialWorkflowState,
  type WorkflowState,
} from './workflow-transitions.ts';
import {
  WORKFLOW_WIDGET_KEY,
  refreshWorkflowTasksFromPlan,
  renderWorkflowWidget,
} from './workflow-tracker.ts';
import { workflowWarningText } from './warnings.ts';

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

export type AppendEntry = (type: string, data: unknown) => void;

const workflowMemory = new Map<string, WorkflowState>();

function workflowStateKey(ctx: WorkflowContext): string {
  const explicitSessionScope = [ctx.sessionId, ctx.conversationId, ctx.id].find(
    (value) => typeof value === 'string' && value.length > 0,
  );
  const projectScope =
    [ctx.cwd, process.cwd()].find(
      (value) => typeof value === 'string' && value.length > 0,
    ) ?? 'default';
  const scope = explicitSessionScope ?? `${process.pid}:${projectScope}`;
  return createHash('sha256').update(scope).digest('hex').slice(0, 24);
}

function projectWorkflowStateKey(ctx: WorkflowContext): string {
  const projectScope =
    [ctx.cwd, process.cwd()].find(
      (value) => typeof value === 'string' && value.length > 0,
    ) ?? 'default';
  return createHash('sha256')
    .update(`project:${projectScope}`)
    .digest('hex')
    .slice(0, 24);
}

function workflowStateDir(ctx?: WorkflowContext): string {
  const projectScope = [ctx?.cwd, process.cwd()].find(
    (value) => typeof value === 'string' && value.length > 0,
  );
  return (
    process.env.PI_ADDY_WORKFLOW_STATE_DIR ??
    (projectScope
      ? join(projectScope, '.pi', 'addy-workflow', 'state')
      : join(homedir(), '.pi', 'agent', 'state', 'pi-addy-workflow'))
  );
}

function workflowStatePath(key: string, ctx?: WorkflowContext): string {
  return join(workflowStateDir(ctx), `${key}.json`);
}

function readStoredWorkflowState(
  key: string,
  ctx?: WorkflowContext,
): WorkflowState | undefined {
  const path = workflowStatePath(key, ctx);
  if (!existsSync(path)) return undefined;

  try {
    return parsePersistedWorkflowState(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

function writeStoredWorkflowState(
  key: string,
  state: WorkflowState,
  ctx?: WorkflowContext,
): void {
  const path = workflowStatePath(key, ctx);
  try {
    mkdirSync(workflowStateDir(ctx), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({ type: WORKFLOW_STATE_ENTRY_TYPE, state }),
      'utf8',
    );
  } catch {
    // Persistence is best-effort; in-memory/session state still drives the current turn.
  }
}

function projectFallbackWorkflowState(
  key: string,
  ctx: WorkflowContext,
): WorkflowState | undefined {
  const state = workflowMemory.get(key) ?? readStoredWorkflowState(key, ctx);
  return state ? sanitizedProjectFallbackAutoControl(state) : undefined;
}

export function getContextWorkflowState(ctx: WorkflowContext): WorkflowState {
  const entries = ctx.sessionManager?.getBranch?.() ?? [];
  const key = workflowStateKey(ctx);
  const projectKey = projectWorkflowStateKey(ctx);
  const projectState =
    workflowMemory.get(projectKey) ?? readStoredWorkflowState(projectKey, ctx);
  const stateIfNotStalePending = (state: WorkflowState): WorkflowState => {
    const projectConsumedPendingFresh = Boolean(
      projectState &&
      state.autoFreshPrompt &&
      state.autoFreshDeliveryKey &&
      projectState.autoFreshConsumedKey === state.autoFreshDeliveryKey,
    );
    if (
      projectState &&
      projectConsumedPendingFresh &&
      !projectState.autoFreshPrompt
    )
      return parseWorkflowState(projectState);
    return withProjectAutoControl(state, projectState);
  };

  for (const entry of [...entries].reverse()) {
    const state = workflowStateFromEntry(entry);
    if (state) return stateIfNotStalePending(state);
  }

  if (ctx.state) return stateIfNotStalePending(parseWorkflowState(ctx.state));

  return (
    workflowMemory.get(key) ??
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
  state = refreshWorkflowTasksFromPlan(state, ctx.cwd);
  ctx.state = state;
  const key = workflowStateKey(ctx);
  const projectKey = projectWorkflowStateKey(ctx);
  workflowMemory.set(key, state);
  workflowMemory.set(projectKey, state);
  writeStoredWorkflowState(key, state, ctx);
  writeStoredWorkflowState(projectKey, state, ctx);
  appendEntry?.(WORKFLOW_STATE_ENTRY_TYPE, state);
  ctx.ui?.setWidget?.(
    WORKFLOW_WIDGET_KEY,
    renderWorkflowWidget(state, ctx.cwd),
  );
  const warning = workflowWarningText(state);
  if (warning) ctx.ui?.notify?.(warning, 'warning');
}

function resetWorkflowState(
  ctx: WorkflowContext,
  state: WorkflowState,
  appendEntry?: AppendEntry,
): WorkflowState {
  ctx.state = state;
  const key = workflowStateKey(ctx);
  const projectKey = projectWorkflowStateKey(ctx);
  workflowMemory.set(key, state);
  workflowMemory.set(projectKey, state);
  writeStoredWorkflowState(key, state, ctx);
  writeStoredWorkflowState(projectKey, state, ctx);
  appendEntry?.(WORKFLOW_STATE_ENTRY_TYPE, state);
  ctx.ui?.setWidget?.(WORKFLOW_WIDGET_KEY, undefined);
  return state;
}

export const workflowStateStore = {
  get: getContextWorkflowState,
  set: setContextWorkflowState,
  reset: resetWorkflowState,
};

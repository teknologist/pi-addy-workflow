import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { WORKFLOW_PHASES, createInitialWorkflowState, transitionWorkflow, type PhaseStatus, type WorkflowEvent, type WorkflowPhase, type WorkflowState } from "./workflow-transitions.ts";
import { WORKFLOW_STATE_ENTRY_TYPE, WORKFLOW_WIDGET_KEY, nextPromptForPhase, parseWorkflowState, promptArtifactForPhase, refreshWorkflowTasksFromPlan, renderWorkflowWidget } from "./workflow-tracker.ts";
import { workflowWarningText } from "./warnings.ts";

type SessionEntry = { type?: string; customType?: string; data?: unknown } | [string, unknown];

type WorkflowContext = {
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
  sessionManager?: {
    getBranch?: () => SessionEntry[];
  };
  state?: WorkflowState;
};

type AppendEntry = (type: string, data: unknown) => void;

const workflowMemory = new Map<string, WorkflowState>();

function isPhaseStatus(value: unknown): value is PhaseStatus {
  return value === "pending" || value === "active" || value === "complete";
}

function coerceWorkflowState(value: unknown): WorkflowState | undefined {
  if (typeof value !== "object" || value === null || !("phases" in value) || !("warnings" in value)) return undefined;

  const candidate = value as Omit<Partial<WorkflowState>, "current"> & { current?: WorkflowPhase | "ship" };
  const rawCurrent = candidate.current;
  const current: WorkflowPhase | undefined = rawCurrent === "ship" ? "finish" : rawCurrent;
  if (current !== undefined && !WORKFLOW_PHASES.includes(current)) return undefined;
  if (!Array.isArray(candidate.warnings) || !candidate.warnings.every((warning) => typeof warning === "string")) return undefined;
  if (candidate.activeSpec !== undefined && typeof candidate.activeSpec !== "string") return undefined;
  if (candidate.activePlan !== undefined && typeof candidate.activePlan !== "string") return undefined;
  if (candidate.currentTask !== undefined && typeof candidate.currentTask !== "string") return undefined;
  if (candidate.nextTask !== undefined && typeof candidate.nextTask !== "string") return undefined;
  if (typeof candidate.phases !== "object" || candidate.phases === null) return undefined;

  const legacyPhases = candidate.phases as Record<string, unknown>;
  const phases = Object.fromEntries(WORKFLOW_PHASES.map((phase) => {
    const status = phase === "finish" ? legacyPhases.finish ?? legacyPhases.ship : legacyPhases[phase];
    return [phase, isPhaseStatus(status) ? status : undefined];
  })) as Record<WorkflowPhase, PhaseStatus | undefined>;
  if (!WORKFLOW_PHASES.every((phase) => phases[phase])) return undefined;

  return { ...candidate, current, phases: phases as Record<WorkflowPhase, PhaseStatus>, warnings: candidate.warnings };
}

function parsePersistedWorkflowState(value: unknown): WorkflowState | undefined {
  const directState = coerceWorkflowState(value);
  if (directState) return parseWorkflowState(directState);

  if (typeof value !== "string") return undefined;

  try {
    const parsed = JSON.parse(value);
    const parsedState = parsed?.type === WORKFLOW_STATE_ENTRY_TYPE ? coerceWorkflowState(parsed.state) : coerceWorkflowState(parsed);
    if (parsedState) return parseWorkflowState(parsedState);
  } catch {
    return undefined;
  }

  return undefined;
}

function workflowStateFromEntry(entry: SessionEntry): WorkflowState | undefined {
  if (Array.isArray(entry)) {
    const [type, data] = entry;
    return type === WORKFLOW_STATE_ENTRY_TYPE ? parsePersistedWorkflowState(data) : undefined;
  }

  if (entry.type === "custom" && entry.customType === WORKFLOW_STATE_ENTRY_TYPE) return parsePersistedWorkflowState(entry.data);
  if (entry.type === WORKFLOW_STATE_ENTRY_TYPE) return parsePersistedWorkflowState(entry.data);

  return undefined;
}

function workflowStateKey(ctx: WorkflowContext): string {
  const explicitSessionScope = [ctx.sessionId, ctx.conversationId, ctx.id].find((value) => typeof value === "string" && value.length > 0);
  const projectScope = [ctx.cwd, process.cwd()].find((value) => typeof value === "string" && value.length > 0) ?? "default";
  const scope = explicitSessionScope ?? `${process.pid}:${projectScope}`;
  return createHash("sha256").update(scope).digest("hex").slice(0, 24);
}

function projectWorkflowStateKey(ctx: WorkflowContext): string {
  const projectScope = [ctx.cwd, process.cwd()].find((value) => typeof value === "string" && value.length > 0) ?? "default";
  return createHash("sha256").update(`project:${projectScope}`).digest("hex").slice(0, 24);
}

function workflowStateDir(): string {
  return process.env.PI_ADDY_WORKFLOW_STATE_DIR ?? join(homedir(), ".pi", "agent", "state", "pi-addy-workflow");
}

function workflowStatePath(key: string): string {
  return join(workflowStateDir(), `${key}.json`);
}

function readStoredWorkflowState(key: string): WorkflowState | undefined {
  const path = workflowStatePath(key);
  if (!existsSync(path)) return undefined;

  try {
    return parsePersistedWorkflowState(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

function writeStoredWorkflowState(key: string, state: WorkflowState): void {
  const path = workflowStatePath(key);
  try {
    mkdirSync(workflowStateDir(), { recursive: true });
    writeFileSync(path, JSON.stringify({ type: WORKFLOW_STATE_ENTRY_TYPE, state }), "utf8");
  } catch {
    // Persistence is best-effort; in-memory/session state still drives the current turn.
  }
}

export function getContextWorkflowState(ctx: WorkflowContext): WorkflowState {
  const entries = ctx.sessionManager?.getBranch?.() ?? [];
  for (const entry of [...entries].reverse()) {
    const state = workflowStateFromEntry(entry);
    if (state) return state;
  }

  if (ctx.state) return parseWorkflowState(ctx.state);

  const key = workflowStateKey(ctx);
  const projectKey = projectWorkflowStateKey(ctx);
  return workflowMemory.get(key) ?? readStoredWorkflowState(key) ?? workflowMemory.get(projectKey) ?? readStoredWorkflowState(projectKey) ?? createInitialWorkflowState();
}

export function setContextWorkflowState(ctx: WorkflowContext, state: WorkflowState, appendEntry?: AppendEntry): void {
  state = refreshWorkflowTasksFromPlan(state, ctx.cwd);
  ctx.state = state;
  const key = workflowStateKey(ctx);
  const projectKey = projectWorkflowStateKey(ctx);
  workflowMemory.set(key, state);
  workflowMemory.set(projectKey, state);
  writeStoredWorkflowState(key, state);
  writeStoredWorkflowState(projectKey, state);
  appendEntry?.(WORKFLOW_STATE_ENTRY_TYPE, state);
  ctx.ui?.setWidget?.(WORKFLOW_WIDGET_KEY, renderWorkflowWidget(state));
  const warning = workflowWarningText(state);
  if (warning) ctx.ui?.notify?.(warning, "warning");
}

export function handleWorkflowEvent(ctx: WorkflowContext, event: WorkflowEvent, appendEntry?: AppendEntry): WorkflowState {
  const next = transitionWorkflow(getContextWorkflowState(ctx), event);
  setContextWorkflowState(ctx, next, appendEntry);
  return ctx.state ?? next;
}

export function resetWorkflow(ctx: WorkflowContext, appendEntry?: AppendEntry): WorkflowState {
  const state = createInitialWorkflowState();
  ctx.state = state;
  const key = workflowStateKey(ctx);
  const projectKey = projectWorkflowStateKey(ctx);
  workflowMemory.set(key, state);
  workflowMemory.set(projectKey, state);
  writeStoredWorkflowState(key, state);
  writeStoredWorkflowState(projectKey, state);
  appendEntry?.(WORKFLOW_STATE_ENTRY_TYPE, state);
  ctx.ui?.setWidget?.(WORKFLOW_WIDGET_KEY, undefined);
  return state;
}

export function openNextWorkflowPrompt(ctx: WorkflowContext, phase: WorkflowPhase, artifact?: string): string {
  const prompt = nextPromptForPhase(phase, artifact ?? promptArtifactForPhase(getContextWorkflowState(ctx), phase));
  ctx.input?.prefill?.(prompt);
  return prompt;
}

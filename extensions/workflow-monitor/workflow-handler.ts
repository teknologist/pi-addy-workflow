import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { complete, type UserMessage } from "@earendil-works/pi-ai";
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
  model?: unknown;
  modelRegistry?: {
    getApiKeyAndHeaders?: (model: unknown) => Promise<{ ok: boolean; apiKey?: string; headers?: Record<string, string>; error?: string }>;
  };
  signal?: AbortSignal;
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

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
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
  if (candidate.autoMode !== undefined && typeof candidate.autoMode !== "boolean") return undefined;
  if (candidate.autoLastPrompt !== undefined && typeof candidate.autoLastPrompt !== "string") return undefined;
  if (candidate.autoRetryKey !== undefined && typeof candidate.autoRetryKey !== "string") return undefined;
  if (candidate.autoRetryCount !== undefined && !isNonNegativeSafeInteger(candidate.autoRetryCount)) return undefined;
  if (candidate.autoReviewFixKey !== undefined && typeof candidate.autoReviewFixKey !== "string") return undefined;
  if (candidate.autoReviewFixCount !== undefined && !isNonNegativeSafeInteger(candidate.autoReviewFixCount)) return undefined;
  if (candidate.autoReviewFindingFingerprint !== undefined && typeof candidate.autoReviewFindingFingerprint !== "string") return undefined;
  if (candidate.autoReviewFixNeedsReview !== undefined && typeof candidate.autoReviewFixNeedsReview !== "boolean") return undefined;
  if (candidate.currentTask !== undefined && typeof candidate.currentTask !== "string") return undefined;
  if (candidate.nextTask !== undefined && typeof candidate.nextTask !== "string") return undefined;
  if (candidate.currentTaskIndex !== undefined && !isPositiveSafeInteger(candidate.currentTaskIndex)) return undefined;
  if (candidate.taskCount !== undefined && !isPositiveSafeInteger(candidate.taskCount)) return undefined;
  if (candidate.currentTaskIndex !== undefined && candidate.taskCount !== undefined && candidate.currentTaskIndex > candidate.taskCount) return undefined;
  if (candidate.currentSliceIndex !== undefined && !isPositiveSafeInteger(candidate.currentSliceIndex)) return undefined;
  if (candidate.sliceCount !== undefined && !isPositiveSafeInteger(candidate.sliceCount)) return undefined;
  if (candidate.currentSliceIndex !== undefined && candidate.sliceCount !== undefined && candidate.currentSliceIndex > candidate.sliceCount) return undefined;
  if (candidate.currentTaskSummary !== undefined && typeof candidate.currentTaskSummary !== "string") return undefined;
  if (candidate.nextTaskSummary !== undefined && typeof candidate.nextTaskSummary !== "string") return undefined;
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
  ctx.ui?.setWidget?.(WORKFLOW_WIDGET_KEY, renderWorkflowWidget(state, ctx.cwd));
  const warning = workflowWarningText(state);
  if (warning) ctx.ui?.notify?.(warning, "warning");
}

function taskNeedsSummary(task: string | undefined, summary: string | undefined): boolean {
  return !!task && task !== "none" && task !== "all tasks complete" && (!summary || summary.length > 36 || summary === task);
}

function fallbackTaskSummary(task: string): string {
  const cleaned = task
    .replace(/\s*;.*$/, "")
    .replace(/\s*—.*$/, "")
    .replace(/\s+-\s+.*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length <= 36 ? cleaned : `${cleaned.slice(0, 33).trimEnd()}…`;
}

function parseTaskSummaryResponse(text: string, state: WorkflowState): Pick<WorkflowState, "currentTaskSummary" | "nextTaskSummary"> {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const current = lines.find((line) => /^current\s*:/i.test(line))?.replace(/^current\s*:\s*/i, "");
  const next = lines.find((line) => /^next\s*:/i.test(line))?.replace(/^next\s*:\s*/i, "");
  return {
    currentTaskSummary: current ? fallbackTaskSummary(current) : state.currentTaskSummary,
    nextTaskSummary: next ? fallbackTaskSummary(next) : state.nextTaskSummary,
  };
}

export async function summarizeWorkflowTasks(ctx: WorkflowContext, state: WorkflowState): Promise<WorkflowState> {
  if (!taskNeedsSummary(state.currentTask, state.currentTaskSummary) && !taskNeedsSummary(state.nextTask, state.nextTaskSummary)) return state;

  const fallbackState = {
    ...state,
    currentTaskSummary: state.currentTask ? fallbackTaskSummary(state.currentTask) : undefined,
    nextTaskSummary: state.nextTask ? fallbackTaskSummary(state.nextTask) : undefined,
  };

  if (!ctx.model || !ctx.modelRegistry?.getApiKeyAndHeaders) return fallbackState;

  try {
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
    if (!auth.ok || !auth.apiKey) return fallbackState;

    const userMessage: UserMessage = {
      role: "user",
      content: [{
        type: "text",
        text: `Summarize these workflow task names for a narrow terminal footer. Each summary must be 2-5 words, <= 32 characters, clear, and meaningful. Keep domain nouns. No markdown.\n\nCurrent: ${state.currentTask ?? "none"}\nNext: ${state.nextTask ?? "none"}\n\nReturn exactly:\nCurrent: <summary>\nNext: <summary>`,
      }],
      timestamp: Date.now(),
    };

    const response = await complete(
      ctx.model as never,
      { systemPrompt: "You produce short labels for a coding workflow footer.", messages: [userMessage] },
      { apiKey: auth.apiKey, headers: auth.headers, signal: ctx.signal },
    );
    if (response.stopReason === "aborted") return fallbackState;

    const text = response.content
      .filter((content): content is { type: "text"; text: string } => content.type === "text")
      .map((content) => content.text)
      .join("\n");
    return { ...fallbackState, ...parseTaskSummaryResponse(text, fallbackState) };
  } catch {
    return fallbackState;
  }
}

export function handleWorkflowEvent(ctx: WorkflowContext, event: WorkflowEvent, appendEntry?: AppendEntry): WorkflowState {
  const next = transitionWorkflow(getContextWorkflowState(ctx), event);
  setContextWorkflowState(ctx, next, appendEntry);
  const source = ctx.state ?? next;
  void summarizeWorkflowTasks(ctx, source).then((summarized) => {
    const latest = ctx.state ?? next;
    if (
      latest.current !== source.current ||
      latest.activePlan !== source.activePlan ||
      latest.currentTask !== source.currentTask ||
      latest.nextTask !== source.nextTask
    ) return;

    if (summarized === source) return;
    setContextWorkflowState(ctx, {
      ...latest,
      currentTaskSummary: summarized.currentTaskSummary,
      nextTaskSummary: summarized.nextTaskSummary,
    }, appendEntry);
  });
  return ctx.state ?? next;
}

export function initializeWorkflowWidget(ctx: WorkflowContext): WorkflowState {
  const state = getContextWorkflowState(ctx);
  setContextWorkflowState(ctx, state);
  return ctx.state ?? state;
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

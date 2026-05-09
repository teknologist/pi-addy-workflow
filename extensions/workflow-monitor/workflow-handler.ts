import { WORKFLOW_PHASES, createInitialWorkflowState, transitionWorkflow, type PhaseStatus, type WorkflowEvent, type WorkflowPhase, type WorkflowState } from "./workflow-transitions.ts";
import { WORKFLOW_STATE_ENTRY_TYPE, WORKFLOW_WIDGET_KEY, nextPromptForPhase, parseWorkflowState, renderWorkflowWidget } from "./workflow-tracker.ts";
import { workflowWarningText } from "./warnings.ts";

type SessionEntry = { type?: string; customType?: string; data?: unknown } | [string, unknown];

type WorkflowContext = {
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

function isPhaseStatus(value: unknown): value is PhaseStatus {
  return value === "pending" || value === "active" || value === "complete";
}

function isWorkflowState(value: unknown): value is WorkflowState {
  if (typeof value !== "object" || value === null || !("phases" in value) || !("warnings" in value)) return false;

  const candidate = value as Partial<WorkflowState>;
  if (candidate.current !== undefined && !WORKFLOW_PHASES.includes(candidate.current)) return false;
  if (!Array.isArray(candidate.warnings) || !candidate.warnings.every((warning) => typeof warning === "string")) return false;
  if (typeof candidate.phases !== "object" || candidate.phases === null) return false;

  return WORKFLOW_PHASES.every((phase) => isPhaseStatus(candidate.phases?.[phase]));
}

function parsePersistedWorkflowState(value: unknown): WorkflowState | undefined {
  if (isWorkflowState(value)) return parseWorkflowState(value);

  if (typeof value !== "string") return undefined;

  try {
    const parsed = JSON.parse(value);
    if (parsed?.type === WORKFLOW_STATE_ENTRY_TYPE && isWorkflowState(parsed.state)) return parseWorkflowState(parsed.state);
    if (isWorkflowState(parsed)) return parseWorkflowState(parsed);
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

export function getContextWorkflowState(ctx: WorkflowContext): WorkflowState {
  const entries = ctx.sessionManager?.getBranch?.() ?? [];
  for (const entry of [...entries].reverse()) {
    const state = workflowStateFromEntry(entry);
    if (state) return state;
  }

  return ctx.state ?? createInitialWorkflowState();
}

export function setContextWorkflowState(ctx: WorkflowContext, state: WorkflowState, appendEntry?: AppendEntry): void {
  ctx.state = state;
  appendEntry?.(WORKFLOW_STATE_ENTRY_TYPE, state);
  ctx.ui?.setWidget?.(WORKFLOW_WIDGET_KEY, renderWorkflowWidget(state));
  const warning = workflowWarningText(state);
  if (warning) ctx.ui?.notify?.(warning, "warning");
}

export function handleWorkflowEvent(ctx: WorkflowContext, event: WorkflowEvent, appendEntry?: AppendEntry): WorkflowState {
  const next = transitionWorkflow(getContextWorkflowState(ctx), event);
  setContextWorkflowState(ctx, next, appendEntry);
  return next;
}

export function resetWorkflow(ctx: WorkflowContext, appendEntry?: AppendEntry): WorkflowState {
  const state = createInitialWorkflowState();
  ctx.state = state;
  appendEntry?.(WORKFLOW_STATE_ENTRY_TYPE, state);
  ctx.ui?.setWidget?.(WORKFLOW_WIDGET_KEY, undefined);
  return state;
}

export function openNextWorkflowPrompt(ctx: WorkflowContext, phase: WorkflowPhase, artifact?: string): string {
  const prompt = nextPromptForPhase(phase, artifact);
  ctx.input?.prefill?.(prompt);
  return prompt;
}

import { createInitialWorkflowState, transitionWorkflow, type WorkflowEvent, type WorkflowPhase, type WorkflowState } from "./workflow-transitions.ts";
import { WORKFLOW_STATE_ENTRY_TYPE, WORKFLOW_WIDGET_KEY, nextPromptForPhase, renderWorkflowWidget } from "./workflow-tracker.ts";
import { workflowWarningText } from "./warnings.ts";

type SessionEntry = { type?: string; customType?: string; data?: unknown };

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

function isWorkflowState(value: unknown): value is WorkflowState {
  return typeof value === "object" && value !== null && "phases" in value;
}

export function getContextWorkflowState(ctx: WorkflowContext): WorkflowState {
  const entries = ctx.sessionManager?.getBranch?.() ?? [];
  for (const entry of [...entries].reverse()) {
    if (entry.type === "custom" && entry.customType === WORKFLOW_STATE_ENTRY_TYPE && isWorkflowState(entry.data)) return entry.data;
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

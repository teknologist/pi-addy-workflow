import { WORKFLOW_PHASES, type WorkflowPhase, type WorkflowState, createInitialWorkflowState } from "./workflow-transitions.ts";

export const WORKFLOW_WIDGET_KEY = "pi-addy-workflow";
export const WORKFLOW_STATE_ENTRY_TYPE = "pi-addy-workflow-state";

export function serializeWorkflowState(state: WorkflowState): string {
  return JSON.stringify({ type: WORKFLOW_STATE_ENTRY_TYPE, state });
}

export function parseWorkflowState(value: unknown): WorkflowState {
  if (!value) return createInitialWorkflowState();

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed?.type === WORKFLOW_STATE_ENTRY_TYPE && parsed.state) return parsed.state as WorkflowState;
      if (parsed?.phases) return parsed as WorkflowState;
    } catch {
      return createInitialWorkflowState();
    }
  }

  if (typeof value === "object" && value !== null && "phases" in value) return value as WorkflowState;
  return createInitialWorkflowState();
}

export function renderWorkflowStrip(state: WorkflowState, theme?: { fg?: (name: string, text: string) => string }): string {
  return WORKFLOW_PHASES.map((phase) => renderPhase(phase, state, theme)).join(" → ");
}

export function renderWorkflowWidget(state: WorkflowState) {
  return (_tui?: unknown, theme?: { fg?: (name: string, text: string) => string }) => ({
    invalidate() {},
    render(): string[] {
      const label = theme?.fg?.("accent", "Addy Workflow: ") ?? theme?.fg?.("blue", "Addy Workflow: ") ?? "Addy Workflow: ";
      return [`${label}${renderWorkflowStrip(state, theme)}`];
    },
  });
}

function renderPhase(phase: WorkflowPhase, state: WorkflowState, theme?: { fg?: (name: string, text: string) => string }): string {
  const status = state.phases[phase];
  if (status === "complete") return `✓${phase}`;
  if (status === "active") {
    const text = `[${phase}]`;
    return theme?.fg?.("success", text) ?? theme?.fg?.("green", text) ?? text;
  }
  return phase;
}

export function nextPromptForPhase(phase: WorkflowPhase, artifact?: string): string {
  const promptByPhase: Record<WorkflowPhase, string> = {
    define: "/addy-spec",
    plan: "/addy-plan",
    build: "/addy-build",
    verify: "/addy-test",
    review: "/addy-review",
    ship: "/addy-ship",
  };

  return artifact ? `${promptByPhase[phase]} ${artifact}` : promptByPhase[phase];
}

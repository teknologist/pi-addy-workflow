import { truncateToWidth } from "@earendil-works/pi-tui";
import { WORKFLOW_PHASES, type WorkflowPhase, type WorkflowState, createInitialWorkflowState } from "./workflow-transitions.ts";

export const WORKFLOW_WIDGET_KEY = "pi-addy-workflow";
export const WORKFLOW_STATE_ENTRY_TYPE = "pi-addy-workflow-state";
const OPTIONAL_PHASES = new Set<WorkflowPhase>(["simplify"]);

function phaseIndex(phase: WorkflowPhase): number {
  return WORKFLOW_PHASES.indexOf(phase);
}

function normalizeWorkflowState(state: WorkflowState): WorkflowState {
  if (!state.current || phaseIndex(state.current) <= phaseIndex("plan")) return state;

  return {
    ...state,
    phases: {
      ...state.phases,
      define: "complete",
      plan: "complete",
    },
  };
}

export function serializeWorkflowState(state: WorkflowState): string {
  return JSON.stringify({ type: WORKFLOW_STATE_ENTRY_TYPE, state });
}

export function parseWorkflowState(value: unknown): WorkflowState {
  if (!value) return createInitialWorkflowState();

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed?.type === WORKFLOW_STATE_ENTRY_TYPE && parsed.state) return normalizeWorkflowState(parsed.state as WorkflowState);
      if (parsed?.phases) return normalizeWorkflowState(parsed as WorkflowState);
    } catch {
      return createInitialWorkflowState();
    }
  }

  if (typeof value === "object" && value !== null && "phases" in value) return normalizeWorkflowState(value as WorkflowState);
  return createInitialWorkflowState();
}

export function renderWorkflowStrip(state: WorkflowState, theme?: { fg?: (name: string, text: string) => string }): string {
  return WORKFLOW_PHASES.map((phase) => renderPhase(phase, state, theme)).join(" → ");
}

export function workflowArtifactForFooter(state: WorkflowState): string | undefined {
  if (!state.current) return undefined;

  if (state.current === "define" || state.current === "plan") return state.activeSpec;
  if (phaseIndex(state.current) > phaseIndex("plan")) return state.activePlan;

  return undefined;
}

export function workflowArtifactName(path: string): string {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ?? path;
}

export function promptArtifactForPhase(state: WorkflowState, phase: WorkflowPhase): string | undefined {
  if (phase === "plan") return state.activeSpec;
  if (phaseIndex(phase) > phaseIndex("plan")) return state.activePlan;
  return undefined;
}

export function renderWorkflowWidget(state: WorkflowState) {
  return (_tui?: unknown, theme?: { fg?: (name: string, text: string) => string }) => ({
    invalidate() {},
    render(width?: number): string[] {
      const label = theme?.fg?.("accent", "Addy Workflow: ") ?? theme?.fg?.("blue", "Addy Workflow: ") ?? "Addy Workflow: ";
      const artifact = workflowArtifactForFooter(state);
      const artifactName = artifact ? workflowArtifactName(artifact) : undefined;
      const styledArtifactName = artifactName ? (theme?.fg?.("mdLinkUrl", artifactName) ?? theme?.fg?.("accent", artifactName) ?? artifactName) : undefined;
      const artifactSuffix = styledArtifactName ? ` | ${styledArtifactName}` : "";
      const line = `${label}${renderWorkflowStrip(state, theme)}${artifactSuffix}`;
      return [width ? truncateToWidth(line, Math.max(1, width), "", true) : line];
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
  if (OPTIONAL_PHASES.has(phase)) return theme?.fg?.("dim", phase) ?? theme?.fg?.("muted", phase) ?? phase;
  return phase;
}

export function nextPromptForPhase(phase: WorkflowPhase, artifact?: string): string {
  const promptByPhase: Record<WorkflowPhase, string> = {
    define: "/addy-define",
    plan: "/addy-plan",
    build: "/addy-build",
    simplify: "/addy-code-simplify",
    verify: "/addy-verify",
    review: "/addy-review",
    finish: "/addy-finish",
  };

  return artifact ? `${promptByPhase[phase]} ${artifact}` : promptByPhase[phase];
}

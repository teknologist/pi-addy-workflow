import type { WorkflowState } from "./workflow-transitions.ts";

export function workflowWarningText(state: WorkflowState): string | undefined {
  return state.warnings[0];
}

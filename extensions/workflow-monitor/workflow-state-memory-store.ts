import type { WorkflowState } from './workflow-core.ts';

const workflowMemory = new Map<string, WorkflowState>();

export function readWorkflowMemoryState(
  key: string,
): WorkflowState | undefined {
  return workflowMemory.get(key);
}

export function writeWorkflowMemoryState(
  key: string,
  state: WorkflowState,
): void {
  workflowMemory.set(key, state);
}

export function writeWorkflowMemoryStates(
  keys: readonly string[],
  state: WorkflowState,
): void {
  for (const key of keys) writeWorkflowMemoryState(key, state);
}

import {
  sanitizedProjectFallbackAutoControl,
  withProjectAutoControl,
} from './auto-control.ts';
import { parseWorkflowState, type WorkflowState } from './workflow-state.ts';

export function sanitizedProjectFallbackWorkflowState(
  state: WorkflowState | undefined,
): WorkflowState | undefined {
  return state ? sanitizedProjectFallbackAutoControl(state) : undefined;
}

export function resolveWorkflowStateWithProjectControl(
  state: WorkflowState,
  projectState: WorkflowState | undefined,
): WorkflowState {
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
}

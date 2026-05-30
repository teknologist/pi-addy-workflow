import {
  createInitialWorkflowState,
  type WorkflowState,
} from './workflow-core.ts';
import { WORKFLOW_STATE_ENTRY_TYPE } from './workflow-state-entry-codec.ts';
import { normalizeWorkflowState } from './workflow-state-normalizer.ts';

export function parseWorkflowState(value: unknown): WorkflowState {
  if (!value) return createInitialWorkflowState();

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed?.type === WORKFLOW_STATE_ENTRY_TYPE && parsed.state)
        return normalizeWorkflowState(parsed.state as WorkflowState);
      if (parsed?.phases)
        return normalizeWorkflowState(parsed as WorkflowState);
    } catch {
      return createInitialWorkflowState();
    }
  }

  if (typeof value === 'object' && value !== null && 'phases' in value)
    return normalizeWorkflowState(value as WorkflowState);
  return createInitialWorkflowState();
}

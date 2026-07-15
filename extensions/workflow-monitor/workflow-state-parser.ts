import {
  createInitialWorkflowState,
  type WorkflowState,
} from './workflow-core.ts';
import { WORKFLOW_STATE_ENTRY_TYPE } from './workflow-state-entry-codec.ts';
import { normalizeWorkflowState } from './workflow-state-normalizer.ts';
import { coerceWorkflowState } from './workflow-state-coercer.ts';

export function parseWorkflowState(value: unknown): WorkflowState {
  if (!value) return createInitialWorkflowState();

  let candidate = value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      candidate =
        parsed?.type === WORKFLOW_STATE_ENTRY_TYPE ? parsed.state : parsed;
    } catch {
      return createInitialWorkflowState();
    }
  }

  const state = coerceWorkflowState(candidate);
  return state ? normalizeWorkflowState(state) : createInitialWorkflowState();
}

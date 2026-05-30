import { autoFreshContinuationKey } from './auto-control.ts';
import {
  transitionWorkflow,
  type AutoFreshReason,
  type WorkflowState,
} from './workflow-transitions.ts';

export function pendingAutoFreshUpdates(
  prompt: string,
  reason: AutoFreshReason,
  state: WorkflowState,
  updates: Partial<WorkflowState> = {},
  expandedPrompt: string,
): Partial<WorkflowState> {
  const pendingState = { ...state, ...updates };
  return {
    autoRetryKey: undefined,
    autoRetryCount: undefined,
    ...updates,
    autoFreshPrompt: prompt,
    autoFreshExpandedPrompt: expandedPrompt,
    autoFreshReason: reason,
    autoFreshDeliveryKey: autoFreshContinuationKey(
      prompt,
      reason,
      pendingState,
    ),
    autoFreshConsumedKey: undefined,
  };
}

export function stateWithPendingFreshPrompt(
  prompt: string,
  reason: AutoFreshReason,
  state: WorkflowState,
  updates: Partial<WorkflowState> = {},
  expandedPrompt: string,
): WorkflowState {
  const pendingState = {
    ...state,
    ...pendingAutoFreshUpdates(prompt, reason, state, updates, expandedPrompt),
  };
  return transitionWorkflow(pendingState, {
    source: 'user-input',
    text: prompt,
    manualAddyCommand: false,
  });
}

import {
  clearAutoFreshUpdates,
  pendingFreshContinuationKey,
  validPendingFreshContinuation,
} from './auto-control.ts';
import { stateAfterAutoPrompt } from './command-dispatch.ts';
import type { WorkflowDispatchOptions } from './workflow-dispatch-options.ts';
import type { WorkflowState } from './workflow-transitions.ts';

export function consumeAutoFreshPromptUpdates(
  state: WorkflowState,
): Partial<WorkflowState> {
  return {
    ...clearAutoFreshUpdates(state),
    autoRetryKey: state.autoRetryKey,
    autoRetryCount: state.autoRetryCount,
  };
}

export function consumedPendingFreshPromptState(
  state: WorkflowState,
): WorkflowState | undefined {
  if (!validPendingFreshContinuation(state)) return undefined;
  const key = pendingFreshContinuationKey(state);
  return stateAfterAutoPrompt(state.autoFreshPrompt, state, {
    ...consumeAutoFreshPromptUpdates({ ...state, autoFreshDeliveryKey: key }),
    autoFreshConsumedKey: key,
  });
}

export function pendingFreshInputMatches(
  input: string,
  state: WorkflowState,
): boolean {
  if (!validPendingFreshContinuation(state)) return false;
  const invocation = input.match(/^Invocation:\s+`([^`]+)`\s*$/m)?.[1];
  return (
    invocation === state.autoFreshPrompt ||
    input === state.autoFreshExpandedPrompt
  );
}

export function currentSessionFallbackOptions(
  options: WorkflowDispatchOptions,
  hasIdleSignal: boolean,
): WorkflowDispatchOptions {
  return {
    ...options,
    useDefaultDelivery: hasIdleSignal ? options.useDefaultDelivery : false,
  };
}

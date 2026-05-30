import type { AutoFreshReason, WorkflowState } from './workflow-transitions.ts';

export type FreshContinuationStartPlan =
  | {
      kind: 'clear-stale';
      state: WorkflowState;
      message: string;
    }
  | { kind: 'already-consumed' }
  | { kind: 'already-delivered' }
  | { kind: 'continue-current-session'; reason: AutoFreshReason }
  | { kind: 'start-fresh-session'; reason: AutoFreshReason };

export function planFreshContinuationStart(input: {
  state: WorkflowState;
  requestedReason: AutoFreshReason;
  canStartFreshSession: boolean;
  consumedKeys: ReadonlySet<string>;
}): FreshContinuationStartPlan {
  const { state } = input;
  if (state.autoFreshPrompt && !state.autoFreshReason) {
    return {
      kind: 'clear-stale',
      state: {
        ...state,
        autoFreshPrompt: undefined,
        autoFreshExpandedPrompt: undefined,
        autoFreshReason: undefined,
        autoFreshDeliveryKey: undefined,
      },
      message:
        'Ignoring stale Addy auto fresh continuation without a recorded reason.',
    };
  }

  if (!state.autoFreshPrompt && state.autoFreshConsumedKey)
    return { kind: 'already-consumed' };

  if (
    state.autoFreshDeliveryKey &&
    input.consumedKeys.has(state.autoFreshDeliveryKey)
  )
    return { kind: 'already-delivered' };

  const reason = state.autoFreshPrompt
    ? (state.autoFreshReason ?? input.requestedReason)
    : input.requestedReason;

  if (!input.canStartFreshSession)
    return { kind: 'continue-current-session', reason };

  return { kind: 'start-fresh-session', reason };
}

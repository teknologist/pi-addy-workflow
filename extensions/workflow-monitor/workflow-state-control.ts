import type { WorkflowState } from './workflow-core.ts';

export const AUTO_CONTROL_FIELDS = [
  'autoLastPrompt',
  'autoPendingAction',
  'autoPausedReason',
  'autoRetryKey',
  'autoRetryCount',
  'autoFreshPrompt',
  'autoFreshExpandedPrompt',
  'autoFreshReason',
  'autoFreshDeliveryKey',
  'autoFreshConsumedKey',
] as const satisfies readonly (keyof WorkflowState)[];

export const REVIEW_CONTROL_FIELDS = [
  'autoReviewFixKey',
  'autoReviewFixCount',
  'autoReviewFindingFingerprint',
  'autoReviewFixNeedsReview',
  'autoReviewTask',
  'autoReviewTaskId',
  'autoReviewTaskIndex',
  'reviewStatsKey',
  'reviewStatsAgent',
] as const satisfies readonly (keyof WorkflowState)[];

export const PROJECT_FALLBACK_CONTROL_FIELDS = [
  ...AUTO_CONTROL_FIELDS,
  ...REVIEW_CONTROL_FIELDS,
] as const satisfies readonly (keyof WorkflowState)[];

const TRANSITION_CONTROL_FIELDS = [
  'autoMode',
  ...AUTO_CONTROL_FIELDS,
  ...REVIEW_CONTROL_FIELDS,
] as const satisfies readonly (keyof WorkflowState)[];

function undefinedFieldUpdates(
  fields: readonly (keyof WorkflowState)[],
): Partial<WorkflowState> {
  return Object.fromEntries(fields.map((field) => [field, undefined]));
}

export function clearReviewControlUpdates(): Partial<WorkflowState> {
  return undefinedFieldUpdates(REVIEW_CONTROL_FIELDS);
}

export function clearReviewControl(state: WorkflowState): WorkflowState {
  return { ...state, ...clearReviewControlUpdates() };
}

export function stopAutoModeControlUpdates(): Partial<WorkflowState> {
  return {
    autoMode: false,
    autoPendingAction: undefined,
    autoPausedReason: 'user-stopped',
    autoLastPrompt: undefined,
    autoRetryKey: undefined,
    autoRetryCount: undefined,
    autoFreshPrompt: undefined,
    autoFreshExpandedPrompt: undefined,
    autoFreshReason: undefined,
    autoFreshDeliveryKey: undefined,
    autoFreshConsumedKey: undefined,
    ...undefinedFieldUpdates(REVIEW_CONTROL_FIELDS),
  };
}

export function exitAutoModeControlUpdates(): Partial<WorkflowState> {
  return {
    ...stopAutoModeControlUpdates(),
    autoPausedReason: undefined,
  };
}

export function enterAutoModeControlUpdates(
  state: WorkflowState,
): Partial<WorkflowState> {
  const pendingFresh =
    state.autoFreshPrompt && state.autoFreshReason
      ? {
          autoFreshPrompt: state.autoFreshPrompt,
          autoFreshExpandedPrompt: state.autoFreshExpandedPrompt,
          autoFreshReason: state.autoFreshReason,
          autoFreshDeliveryKey: state.autoFreshDeliveryKey,
          autoFreshConsumedKey: state.autoFreshConsumedKey,
        }
      : {
          autoFreshPrompt: undefined,
          autoFreshExpandedPrompt: undefined,
          autoFreshReason: undefined,
          autoFreshDeliveryKey: undefined,
          autoFreshConsumedKey: undefined,
        };

  return {
    autoMode: true,
    autoPendingAction: undefined,
    autoPausedReason: undefined,
    autoLastPrompt: undefined,
    autoRetryKey: undefined,
    autoRetryCount: undefined,
    ...pendingFresh,
    ...undefinedFieldUpdates(REVIEW_CONTROL_FIELDS),
  };
}

export function preserveWorkflowControlState(
  target: WorkflowState,
  source: WorkflowState,
): WorkflowState {
  const next = { ...target };
  for (const field of TRANSITION_CONTROL_FIELDS) {
    next[field] = source[field] as never;
  }
  return next;
}

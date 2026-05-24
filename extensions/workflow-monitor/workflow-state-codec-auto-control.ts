import type { WorkflowState } from './workflow-core.ts';
import {
  isNonNegativeSafeInteger,
  isOptionalBoolean,
  isOptionalString,
} from './workflow-state-codec-primitives.ts';
import {
  isAutoFreshReason,
  isAutoPausedReason,
} from './workflow-state-codec-domains.ts';

type WorkflowAutoControlFields = Pick<
  WorkflowState,
  | 'autoMode'
  | 'autoPausedReason'
  | 'autoLastPrompt'
  | 'autoFreshPrompt'
  | 'autoFreshExpandedPrompt'
  | 'autoFreshReason'
  | 'autoFreshDeliveryKey'
  | 'autoFreshConsumedKey'
  | 'autoRetryKey'
  | 'autoRetryCount'
>;

export function coerceWorkflowAutoControl(
  candidate: Partial<WorkflowAutoControlFields>,
): WorkflowAutoControlFields | undefined {
  if (!isOptionalBoolean(candidate.autoMode)) return undefined;
  if (
    candidate.autoPausedReason !== undefined &&
    !isAutoPausedReason(candidate.autoPausedReason)
  )
    return undefined;
  if (!isOptionalString(candidate.autoLastPrompt)) return undefined;
  if (!isOptionalString(candidate.autoFreshPrompt)) return undefined;
  if (!isOptionalString(candidate.autoFreshExpandedPrompt)) return undefined;
  if (
    candidate.autoFreshReason !== undefined &&
    !isAutoFreshReason(candidate.autoFreshReason)
  )
    return undefined;
  if (!isOptionalString(candidate.autoFreshDeliveryKey)) return undefined;
  if (!isOptionalString(candidate.autoFreshConsumedKey)) return undefined;
  if (!isOptionalString(candidate.autoRetryKey)) return undefined;
  if (
    candidate.autoRetryCount !== undefined &&
    !isNonNegativeSafeInteger(candidate.autoRetryCount)
  )
    return undefined;

  return {
    autoMode: candidate.autoMode,
    autoPausedReason: candidate.autoPausedReason,
    autoLastPrompt: candidate.autoLastPrompt,
    autoFreshPrompt: candidate.autoFreshPrompt,
    autoFreshExpandedPrompt: candidate.autoFreshExpandedPrompt,
    autoFreshReason: candidate.autoFreshReason,
    autoFreshDeliveryKey: candidate.autoFreshDeliveryKey,
    autoFreshConsumedKey: candidate.autoFreshConsumedKey,
    autoRetryKey: candidate.autoRetryKey,
    autoRetryCount: candidate.autoRetryCount,
  };
}

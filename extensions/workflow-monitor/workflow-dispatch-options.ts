import type { AutoFreshReason } from './workflow-transitions.ts';

export type WorkflowDispatchOptions = {
  freshContextBypassReason?: AutoFreshReason;
  appendEntry?: boolean;
  useDefaultDelivery?: boolean;
  idleTurnDelivery?: boolean;
  disableFreshSession?: boolean;
  disableCompaction?: boolean;
  allowSamePhase?: boolean;
};

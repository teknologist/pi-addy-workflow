import type { WorkflowState } from './workflow-core.ts';
import { isOptionalString } from './workflow-state-codec-primitives.ts';
import { isWorkflowTestStatus } from './workflow-state-codec-domains.ts';

export type WorkflowMetadataFields = Pick<
  WorkflowState,
  | 'warnings'
  | 'activeSpec'
  | 'activePlan'
  | 'activeSuitePlan'
  | 'lastTrigger'
  | 'lastArtifact'
  | 'testStatus'
>;

export function sanitizePlanArtifact(
  planPath: string | undefined,
): string | undefined {
  if (planPath?.startsWith('/') && !/\.md$/i.test(planPath)) return undefined;
  return planPath;
}

export function sanitizeWorkflowArtifacts(state: WorkflowState): WorkflowState {
  const activePlan = sanitizePlanArtifact(state.activePlan);
  const activeSuitePlan = sanitizePlanArtifact(state.activeSuitePlan);
  if (
    activePlan === state.activePlan &&
    activeSuitePlan === state.activeSuitePlan
  )
    return state;
  return { ...state, activePlan, activeSuitePlan };
}

export function coerceWorkflowMetadata(
  candidate: Partial<WorkflowMetadataFields>,
): WorkflowMetadataFields | undefined {
  if (
    !Array.isArray(candidate.warnings) ||
    !candidate.warnings.every((warning) => typeof warning === 'string')
  )
    return undefined;
  if (!isOptionalString(candidate.activeSpec)) return undefined;
  if (!isOptionalString(candidate.activePlan)) return undefined;
  if (!isOptionalString(candidate.activeSuitePlan)) return undefined;
  if (!isOptionalString(candidate.lastTrigger)) return undefined;
  if (!isOptionalString(candidate.lastArtifact)) return undefined;
  if (
    candidate.testStatus !== undefined &&
    !isWorkflowTestStatus(candidate.testStatus)
  )
    return undefined;

  return {
    warnings: candidate.warnings,
    activeSpec: candidate.activeSpec,
    activePlan: candidate.activePlan,
    activeSuitePlan: candidate.activeSuitePlan,
    lastTrigger: candidate.lastTrigger,
    lastArtifact: candidate.lastArtifact,
    testStatus: candidate.testStatus,
  };
}

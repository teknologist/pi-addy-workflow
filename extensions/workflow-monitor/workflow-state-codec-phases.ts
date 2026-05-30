import {
  WORKFLOW_PHASES,
  type PhaseStatus,
  type WorkflowPhase,
} from './workflow-phases.ts';

export function isPhaseStatus(value: unknown): value is PhaseStatus {
  return value === 'pending' || value === 'active' || value === 'complete';
}

export function coerceWorkflowPhases(
  value: unknown,
): Record<WorkflowPhase, PhaseStatus> | undefined {
  if (typeof value !== 'object' || value === null) return undefined;

  const legacyPhases = value as Record<string, unknown>;
  const phases = Object.fromEntries(
    WORKFLOW_PHASES.map((phase) => {
      const status =
        phase === 'finish'
          ? (legacyPhases.finish ?? legacyPhases.ship)
          : legacyPhases[phase];
      return [phase, isPhaseStatus(status) ? status : undefined];
    }),
  ) as Record<WorkflowPhase, PhaseStatus | undefined>;

  return WORKFLOW_PHASES.every((phase) => phases[phase])
    ? (phases as Record<WorkflowPhase, PhaseStatus>)
    : undefined;
}

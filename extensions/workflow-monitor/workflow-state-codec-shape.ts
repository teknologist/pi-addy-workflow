import { WORKFLOW_PHASES, type WorkflowPhase } from './workflow-phases.ts';

export type WorkflowStateShape = { phases: unknown; warnings: unknown };
export type PersistedWorkflowCurrent = WorkflowPhase | 'ship' | undefined;

export function hasWorkflowStateShape(
  value: unknown,
): value is WorkflowStateShape {
  if (typeof value !== 'object') return false;
  if (value === null) return false;
  if (!('phases' in value)) return false;
  return 'warnings' in value;
}

export function coerceWorkflowCurrent(
  value: unknown,
): WorkflowPhase | undefined {
  const current = value === 'ship' ? 'finish' : value;
  if (current === undefined) return undefined;
  return WORKFLOW_PHASES.includes(current as WorkflowPhase)
    ? (current as WorkflowPhase)
    : undefined;
}

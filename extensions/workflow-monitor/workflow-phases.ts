export const WORKFLOW_PHASES = [
  'define',
  'plan',
  'build',
  'simplify',
  'verify',
  'review',
  'finish',
] as const;

export const ENFORCED_WORKFLOW_PHASES = ['build', 'verify', 'review'] as const;

export type WorkflowPhase = (typeof WORKFLOW_PHASES)[number];
export type PhaseStatus = 'pending' | 'active' | 'complete';

export function phaseIndex(phase: WorkflowPhase): number {
  return WORKFLOW_PHASES.indexOf(phase);
}

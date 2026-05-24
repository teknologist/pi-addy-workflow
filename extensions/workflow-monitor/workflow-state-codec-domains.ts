import type {
  AutoFreshReason,
  WorkflowAutoPausedReason,
  WorkflowState,
} from './workflow-core.ts';

export function isAutoFreshReason(value: unknown): value is AutoFreshReason {
  return (
    value === 'between-tasks' ||
    value === 'before-step' ||
    value === 'before-review'
  );
}

export function isAutoPausedReason(
  value: unknown,
): value is WorkflowAutoPausedReason {
  return (
    value === 'unclear-commit-result' ||
    value === 'max-review-fix-loops' ||
    value === 'repeated-review-finding' ||
    value === 'same-phase-retry-limit' ||
    value === 'user-stopped'
  );
}

export function isWorkflowTestStatus(
  value: unknown,
): value is NonNullable<WorkflowState['testStatus']> {
  return value === 'detected' || value === 'passed' || value === 'failed';
}

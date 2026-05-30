import type {
  WorkflowPhase,
  WorkflowState,
  WorkflowTaskCommitRecord,
} from './workflow-core.ts';
import { coerceAutoPendingAction } from './workflow-state-codec-auto.ts';
import { coerceWorkflowAutoControl } from './workflow-state-codec-auto-control.ts';
import {
  backfillCommittedTasksFromStats,
  coerceCommittedTasks,
} from './workflow-state-codec-commits.ts';
import { coerceWorkflowPhases } from './workflow-state-codec-phases.ts';
import { coerceWorkflowTaskProgress } from './workflow-state-codec-tasks.ts';
import { coerceWorkflowReviewControl } from './workflow-state-codec-review.ts';
import { coerceWorkflowMetadata } from './workflow-state-codec-metadata.ts';
import {
  coerceWorkflowCurrent,
  hasWorkflowStateShape,
} from './workflow-state-codec-shape.ts';

function migrateCommittedTasks(
  candidate: { stats?: unknown },
  committedTasks: Record<string, WorkflowTaskCommitRecord> | undefined,
): Record<string, WorkflowTaskCommitRecord> | undefined {
  const legacyCommittedTasks = backfillCommittedTasksFromStats(candidate.stats);
  if (!legacyCommittedTasks) return committedTasks;
  return { ...legacyCommittedTasks, ...committedTasks };
}

export function coerceWorkflowState(value: unknown): WorkflowState | undefined {
  if (!hasWorkflowStateShape(value)) return undefined;

  const candidate = value as Omit<Partial<WorkflowState>, 'current'> & {
    current?: WorkflowPhase | 'ship';
  };
  const current = coerceWorkflowCurrent(candidate.current);
  if (candidate.current !== undefined && !current) return undefined;
  const metadata = coerceWorkflowMetadata(candidate);
  if (!metadata) return undefined;
  const committedTasks = coerceCommittedTasks(candidate.committedTasks);
  if (candidate.committedTasks !== undefined && !committedTasks)
    return undefined;
  const migratedCommittedTasks = migrateCommittedTasks(
    candidate,
    committedTasks,
  );
  const autoControl = coerceWorkflowAutoControl(candidate);
  if (!autoControl) return undefined;
  const autoPendingAction = coerceAutoPendingAction(
    candidate.autoPendingAction,
  );
  if (candidate.autoPendingAction !== undefined && !autoPendingAction)
    return undefined;
  if (!coerceWorkflowReviewControl(candidate)) return undefined;
  if (!coerceWorkflowTaskProgress(candidate)) return undefined;
  const phases = coerceWorkflowPhases(candidate.phases);
  if (!phases) return undefined;

  return {
    ...candidate,
    ...autoControl,
    committedTasks: migratedCommittedTasks,
    autoPendingAction,
    current,
    phases,
    warnings: metadata.warnings,
  };
}

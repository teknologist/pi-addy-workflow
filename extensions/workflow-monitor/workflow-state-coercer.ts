import {
  createInitialWorkflowState,
  type WorkflowPhase,
  type WorkflowState,
  type WorkflowTaskCommitRecord,
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
import {
  coerceTicketExecution,
  corruptTicketExecution,
  hasTicketAssociation,
} from './workflow-state-codec-ticket.ts';

function migrateCommittedTasks(
  candidate: { stats?: unknown },
  committedTasks: Record<string, WorkflowTaskCommitRecord> | undefined,
): Record<string, WorkflowTaskCommitRecord> | undefined {
  const legacyCommittedTasks = backfillCommittedTasksFromStats(candidate.stats);
  if (!legacyCommittedTasks) return committedTasks;
  return { ...legacyCommittedTasks, ...committedTasks };
}

export function coerceWorkflowState(value: unknown): WorkflowState | undefined {
  if (!hasWorkflowStateShape(value))
    return hasTicketAssociation(value)
      ? corruptTicketExecution(
          value as Record<string, unknown>,
          createInitialWorkflowState(),
        )
      : undefined;

  const candidate = value as Omit<Partial<WorkflowState>, 'current'> & {
    current?: WorkflowPhase | 'ship';
  };
  const invalid = (): WorkflowState | undefined =>
    hasTicketAssociation(candidate)
      ? corruptTicketExecution(
          candidate as Record<string, unknown>,
          createInitialWorkflowState(),
        )
      : undefined;
  const current = coerceWorkflowCurrent(candidate.current);
  if (candidate.current !== undefined && !current) return invalid();
  const metadata = coerceWorkflowMetadata(candidate);
  if (!metadata) return invalid();
  const committedTasks = coerceCommittedTasks(candidate.committedTasks);
  if (candidate.committedTasks !== undefined && !committedTasks)
    return invalid();
  const migratedCommittedTasks = migrateCommittedTasks(
    candidate,
    committedTasks,
  );
  const autoControl = coerceWorkflowAutoControl(candidate);
  if (!autoControl) return invalid();
  const autoPendingAction = coerceAutoPendingAction(
    candidate.autoPendingAction,
  );
  if (candidate.autoPendingAction !== undefined && !autoPendingAction)
    return invalid();
  if (!coerceWorkflowReviewControl(candidate)) return invalid();
  if (!coerceWorkflowTaskProgress(candidate)) return invalid();
  const phases = coerceWorkflowPhases(candidate.phases);
  if (!phases) return invalid();

  const base = {
    ...candidate,
    ...autoControl,
    committedTasks: migratedCommittedTasks,
    autoPendingAction,
    current,
    phases,
    warnings: metadata.warnings,
  } as WorkflowState;
  return coerceTicketExecution(candidate as Record<string, unknown>, base);
}

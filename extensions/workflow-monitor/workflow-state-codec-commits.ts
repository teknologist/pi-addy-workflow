import { createHash } from 'node:crypto';
import { workflowTaskCommitKey } from './plan-task-lifecycle.ts';
import type {
  WorkflowTaskCommitRecord,
  WorkflowTaskStats,
} from './workflow-core.ts';
import { isPositiveSafeInteger } from './workflow-state-codec-primitives.ts';

export function isWorkflowTaskCommitRecord(
  value: unknown,
): value is WorkflowTaskCommitRecord {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<WorkflowTaskCommitRecord>;
  return (
    typeof candidate.plan === 'string' &&
    (candidate.taskId === undefined || typeof candidate.taskId === 'string') &&
    (candidate.sliceIndex === undefined ||
      isPositiveSafeInteger(candidate.sliceIndex)) &&
    isPositiveSafeInteger(candidate.taskIndex) &&
    typeof candidate.taskTitle === 'string' &&
    typeof candidate.commitSha === 'string' &&
    typeof candidate.committedAt === 'string'
  );
}

export function coerceCommittedTasks(
  value: unknown,
): Record<string, WorkflowTaskCommitRecord> | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return undefined;

  const committedTasks: Record<string, WorkflowTaskCommitRecord> = {};
  for (const [key, record] of Object.entries(value)) {
    if (!isWorkflowTaskCommitRecord(record)) continue;
    committedTasks[key] = record;
  }
  return committedTasks;
}

function taskStatHasLifecycleEvidence(
  value: Partial<WorkflowTaskStats>,
): boolean {
  return (
    typeof value.verifyRuns === 'number' &&
    value.verifyRuns > 0 &&
    typeof value.reviewRuns === 'number' &&
    value.reviewRuns > 0
  );
}

export function backfillCommittedTasksFromStats(
  value: unknown,
): Record<string, WorkflowTaskCommitRecord> | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const history = (value as { history?: unknown }).history;
  if (!Array.isArray(history)) return undefined;

  const committedTasks: Record<string, WorkflowTaskCommitRecord> = {};
  for (const session of history) {
    if (typeof session !== 'object' || session === null) continue;
    const candidateSession = session as {
      endedReason?: unknown;
      tasks?: unknown;
    };
    if (candidateSession.endedReason !== 'task-commit') continue;
    if (
      typeof candidateSession.tasks !== 'object' ||
      candidateSession.tasks === null ||
      Array.isArray(candidateSession.tasks)
    )
      continue;

    for (const task of Object.values(candidateSession.tasks)) {
      if (typeof task !== 'object' || task === null) continue;
      const candidate = task as Partial<WorkflowTaskStats>;
      if (
        typeof candidate.plan !== 'string' ||
        !/\.md$/i.test(candidate.plan) ||
        !isPositiveSafeInteger(candidate.taskIndex) ||
        typeof candidate.taskTitle !== 'string' ||
        candidate.taskTitle.length === 0 ||
        !taskStatHasLifecycleEvidence(candidate)
      )
        continue;

      const taskId =
        typeof candidate.taskId === 'string' && candidate.taskId.length > 0
          ? candidate.taskId
          : undefined;
      const key = workflowTaskCommitKey(
        candidate.plan,
        candidate.taskIndex,
        candidate.taskTitle,
        taskId,
      );
      committedTasks[key] = {
        plan: candidate.plan,
        ...(taskId ? { taskId } : {}),
        sliceIndex: isPositiveSafeInteger(candidate.sliceIndex)
          ? candidate.sliceIndex
          : undefined,
        taskIndex: candidate.taskIndex,
        taskTitle: candidate.taskTitle,
        commitSha: `legacy:${createHash('sha256')
          .update(key)
          .digest('hex')
          .slice(0, 12)}`,
        committedAt: 'legacy-task-commit',
      };
    }
  }

  return Object.keys(committedTasks).length > 0 ? committedTasks : undefined;
}

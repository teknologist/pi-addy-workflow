import { createHash } from 'node:crypto';
import {
  WORKFLOW_PHASES,
  createInitialWorkflowState,
  phaseIndex,
  type PhaseStatus,
  type WorkflowAutoPendingAction,
  type WorkflowPhase,
  type WorkflowState,
  type WorkflowTaskCommitRecord,
  type WorkflowTaskStats,
} from './workflow-transitions.ts';
import { workflowTaskCommitKey } from './plan-task-lifecycle.ts';
import { normalizeWorkflowStats } from './workflow-stats.ts';

export type WorkflowStateEntry =
  | { type?: string; customType?: string; data?: unknown }
  | [string, unknown];

export const WORKFLOW_STATE_ENTRY_TYPE = 'pi-addy-workflow-state';

function sanitizePlanArtifact(
  planPath: string | undefined,
): string | undefined {
  if (planPath?.startsWith('/') && !/\.md$/i.test(planPath)) return undefined;
  return planPath;
}

function sanitizeWorkflowArtifacts(state: WorkflowState): WorkflowState {
  const activePlan = sanitizePlanArtifact(state.activePlan);
  const activeSuitePlan = sanitizePlanArtifact(state.activeSuitePlan);
  if (
    activePlan === state.activePlan &&
    activeSuitePlan === state.activeSuitePlan
  )
    return state;
  return { ...state, activePlan, activeSuitePlan };
}

export function normalizeWorkflowState(state: WorkflowState): WorkflowState {
  const sanitizedState = sanitizeWorkflowArtifacts(state);
  const normalizedTasks =
    sanitizedState.currentTask || sanitizedState.nextTask
      ? {
          currentTask: sanitizedState.currentTask,
          currentTaskId: sanitizedState.currentTaskId,
          nextTask: sanitizedState.nextTask,
          nextTaskId: sanitizedState.nextTaskId,
          currentTaskIndex: sanitizedState.currentTaskIndex,
          taskCount: sanitizedState.taskCount,
          currentSliceIndex: sanitizedState.currentSliceIndex,
          sliceCount: sanitizedState.sliceCount,
          currentTaskSummary: sanitizedState.currentTaskSummary,
          nextTaskSummary: sanitizedState.nextTaskSummary,
        }
      : {};

  const normalizedStats = {
    stats: normalizeWorkflowStats(sanitizedState.stats),
  };

  if (
    !sanitizedState.current ||
    phaseIndex(sanitizedState.current) <= phaseIndex('plan')
  )
    return { ...sanitizedState, ...normalizedTasks, ...normalizedStats };

  return {
    ...sanitizedState,
    ...normalizedTasks,
    ...normalizedStats,
    phases: {
      ...sanitizedState.phases,
      define: 'complete',
      plan: 'complete',
    },
  };
}

export function serializeWorkflowState(state: WorkflowState): string {
  return JSON.stringify({ type: WORKFLOW_STATE_ENTRY_TYPE, state });
}

export function parseWorkflowState(value: unknown): WorkflowState {
  if (!value) return createInitialWorkflowState();

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed?.type === WORKFLOW_STATE_ENTRY_TYPE && parsed.state)
        return normalizeWorkflowState(parsed.state as WorkflowState);
      if (parsed?.phases)
        return normalizeWorkflowState(parsed as WorkflowState);
    } catch {
      return createInitialWorkflowState();
    }
  }

  if (typeof value === 'object' && value !== null && 'phases' in value)
    return normalizeWorkflowState(value as WorkflowState);
  return createInitialWorkflowState();
}

function isPhaseStatus(value: unknown): value is PhaseStatus {
  return value === 'pending' || value === 'active' || value === 'complete';
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isWorkflowTaskCommitRecord(
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

function coerceCommittedTasks(
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

function isAutoPendingActionReason(
  value: unknown,
): value is WorkflowAutoPendingAction['reason'] {
  return (
    value === 'next-action' ||
    value === 'fresh-fallback' ||
    value === 'idle-retry' ||
    value === 'commit-frontier'
  );
}

function coerceAutoPendingAction(
  value: unknown,
): WorkflowAutoPendingAction | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return undefined;
  const candidate = value as Partial<WorkflowAutoPendingAction>;
  if (
    typeof candidate.key !== 'string' ||
    candidate.key.length === 0 ||
    typeof candidate.prompt !== 'string' ||
    candidate.prompt.length === 0 ||
    !isAutoPendingActionReason(candidate.reason) ||
    !isNonNegativeSafeInteger(candidate.attempts) ||
    typeof candidate.createdAt !== 'string'
  )
    return undefined;
  if (
    candidate.expandedPrompt !== undefined &&
    typeof candidate.expandedPrompt !== 'string'
  )
    return undefined;
  if (candidate.plan !== undefined && typeof candidate.plan !== 'string')
    return undefined;
  if (candidate.taskId !== undefined && typeof candidate.taskId !== 'string')
    return undefined;
  if (
    candidate.taskIndex !== undefined &&
    !isPositiveSafeInteger(candidate.taskIndex)
  )
    return undefined;
  if (
    candidate.taskTitle !== undefined &&
    typeof candidate.taskTitle !== 'string'
  )
    return undefined;
  if (
    candidate.sliceIndex !== undefined &&
    !isPositiveSafeInteger(candidate.sliceIndex)
  )
    return undefined;
  return {
    key: candidate.key,
    prompt: candidate.prompt,
    expandedPrompt: candidate.expandedPrompt,
    plan: candidate.plan,
    taskId: candidate.taskId,
    taskIndex: candidate.taskIndex,
    taskTitle: candidate.taskTitle,
    sliceIndex: candidate.sliceIndex,
    reason: candidate.reason,
    attempts: candidate.attempts,
    createdAt: candidate.createdAt,
  };
}

function isAutoPausedReason(value: unknown): boolean {
  return (
    value === 'unclear-commit-result' ||
    value === 'max-review-fix-loops' ||
    value === 'repeated-review-finding' ||
    value === 'same-phase-retry-limit' ||
    value === 'user-stopped'
  );
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

function backfillCommittedTasksFromStats(
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

      const key = workflowTaskCommitKey(
        candidate.plan,
        candidate.taskIndex,
        candidate.taskTitle,
      );
      committedTasks[key] = {
        plan: candidate.plan,
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

function migrateCommittedTasks(
  candidate: { stats?: unknown },
  committedTasks: Record<string, WorkflowTaskCommitRecord> | undefined,
): Record<string, WorkflowTaskCommitRecord> | undefined {
  const legacyCommittedTasks = backfillCommittedTasksFromStats(candidate.stats);
  if (!legacyCommittedTasks) return committedTasks;
  return { ...legacyCommittedTasks, ...committedTasks };
}

function hasWorkflowStateShape(
  value: unknown,
): value is { phases: unknown; warnings: unknown } {
  if (typeof value !== 'object') return false;
  if (value === null) return false;
  if (!('phases' in value)) return false;
  return 'warnings' in value;
}

function coerceWorkflowState(value: unknown): WorkflowState | undefined {
  if (!hasWorkflowStateShape(value)) return undefined;

  const candidate = value as Omit<Partial<WorkflowState>, 'current'> & {
    current?: WorkflowPhase | 'ship';
  };
  const rawCurrent = candidate.current;
  const current: WorkflowPhase | undefined =
    rawCurrent === 'ship' ? 'finish' : rawCurrent;
  if (current !== undefined && !WORKFLOW_PHASES.includes(current))
    return undefined;
  if (
    !Array.isArray(candidate.warnings) ||
    !candidate.warnings.every((warning) => typeof warning === 'string')
  )
    return undefined;
  if (
    candidate.activeSpec !== undefined &&
    typeof candidate.activeSpec !== 'string'
  )
    return undefined;
  if (
    candidate.activePlan !== undefined &&
    typeof candidate.activePlan !== 'string'
  )
    return undefined;
  if (
    candidate.activeSuitePlan !== undefined &&
    typeof candidate.activeSuitePlan !== 'string'
  )
    return undefined;
  const committedTasks = coerceCommittedTasks(candidate.committedTasks);
  if (candidate.committedTasks !== undefined && !committedTasks)
    return undefined;
  const migratedCommittedTasks = migrateCommittedTasks(
    candidate,
    committedTasks,
  );
  if (
    candidate.autoMode !== undefined &&
    typeof candidate.autoMode !== 'boolean'
  )
    return undefined;
  const autoPendingAction = coerceAutoPendingAction(
    candidate.autoPendingAction,
  );
  if (candidate.autoPendingAction !== undefined && !autoPendingAction)
    return undefined;
  if (
    candidate.autoPausedReason !== undefined &&
    !isAutoPausedReason(candidate.autoPausedReason)
  )
    return undefined;
  if (
    candidate.autoLastPrompt !== undefined &&
    typeof candidate.autoLastPrompt !== 'string'
  )
    return undefined;
  if (
    candidate.autoFreshPrompt !== undefined &&
    typeof candidate.autoFreshPrompt !== 'string'
  )
    return undefined;
  if (
    candidate.autoFreshExpandedPrompt !== undefined &&
    typeof candidate.autoFreshExpandedPrompt !== 'string'
  )
    return undefined;
  if (
    candidate.autoFreshReason !== undefined &&
    !['between-tasks', 'before-step', 'before-review'].includes(
      candidate.autoFreshReason,
    )
  )
    return undefined;
  if (
    candidate.autoFreshDeliveryKey !== undefined &&
    typeof candidate.autoFreshDeliveryKey !== 'string'
  )
    return undefined;
  if (
    candidate.autoFreshConsumedKey !== undefined &&
    typeof candidate.autoFreshConsumedKey !== 'string'
  )
    return undefined;
  if (
    candidate.autoRetryKey !== undefined &&
    typeof candidate.autoRetryKey !== 'string'
  )
    return undefined;
  if (
    candidate.autoRetryCount !== undefined &&
    !isNonNegativeSafeInteger(candidate.autoRetryCount)
  )
    return undefined;
  if (
    candidate.autoReviewFixKey !== undefined &&
    typeof candidate.autoReviewFixKey !== 'string'
  )
    return undefined;
  if (
    candidate.autoReviewFixCount !== undefined &&
    !isNonNegativeSafeInteger(candidate.autoReviewFixCount)
  )
    return undefined;
  if (
    candidate.autoReviewFindingFingerprint !== undefined &&
    typeof candidate.autoReviewFindingFingerprint !== 'string'
  )
    return undefined;
  if (
    candidate.autoReviewFixNeedsReview !== undefined &&
    typeof candidate.autoReviewFixNeedsReview !== 'boolean'
  )
    return undefined;
  if (
    candidate.autoReviewTask !== undefined &&
    typeof candidate.autoReviewTask !== 'string'
  )
    return undefined;
  if (
    candidate.autoReviewTaskId !== undefined &&
    typeof candidate.autoReviewTaskId !== 'string'
  )
    return undefined;
  if (
    candidate.autoReviewTaskIndex !== undefined &&
    !isPositiveSafeInteger(candidate.autoReviewTaskIndex)
  )
    return undefined;
  if (
    candidate.reviewStatsKey !== undefined &&
    typeof candidate.reviewStatsKey !== 'string'
  )
    return undefined;
  if (
    candidate.reviewStatsAgent !== undefined &&
    typeof candidate.reviewStatsAgent !== 'string'
  )
    return undefined;
  if (
    candidate.currentTask !== undefined &&
    typeof candidate.currentTask !== 'string'
  )
    return undefined;
  if (
    candidate.currentTaskId !== undefined &&
    typeof candidate.currentTaskId !== 'string'
  )
    return undefined;
  if (
    candidate.nextTask !== undefined &&
    typeof candidate.nextTask !== 'string'
  )
    return undefined;
  if (
    candidate.nextTaskId !== undefined &&
    typeof candidate.nextTaskId !== 'string'
  )
    return undefined;
  if (
    candidate.currentTaskIndex !== undefined &&
    !isPositiveSafeInteger(candidate.currentTaskIndex)
  )
    return undefined;
  if (
    candidate.taskCount !== undefined &&
    !isPositiveSafeInteger(candidate.taskCount)
  )
    return undefined;
  if (
    candidate.currentTaskIndex !== undefined &&
    candidate.taskCount !== undefined &&
    candidate.currentTaskIndex > candidate.taskCount
  )
    return undefined;
  if (
    candidate.currentSliceIndex !== undefined &&
    !isPositiveSafeInteger(candidate.currentSliceIndex)
  )
    return undefined;
  if (
    candidate.sliceCount !== undefined &&
    !isPositiveSafeInteger(candidate.sliceCount)
  )
    return undefined;
  if (
    candidate.currentSliceIndex !== undefined &&
    candidate.sliceCount !== undefined &&
    candidate.currentSliceIndex > candidate.sliceCount
  )
    return undefined;
  if (
    candidate.currentTaskSummary !== undefined &&
    typeof candidate.currentTaskSummary !== 'string'
  )
    return undefined;
  if (
    candidate.nextTaskSummary !== undefined &&
    typeof candidate.nextTaskSummary !== 'string'
  )
    return undefined;
  if (
    candidate.lastTrigger !== undefined &&
    typeof candidate.lastTrigger !== 'string'
  )
    return undefined;
  if (
    candidate.lastArtifact !== undefined &&
    typeof candidate.lastArtifact !== 'string'
  )
    return undefined;
  if (
    candidate.testStatus !== undefined &&
    !['detected', 'passed', 'failed'].includes(candidate.testStatus)
  )
    return undefined;
  if (typeof candidate.phases !== 'object' || candidate.phases === null)
    return undefined;

  const legacyPhases = candidate.phases as Record<string, unknown>;
  const phases = Object.fromEntries(
    WORKFLOW_PHASES.map((phase) => {
      const status =
        phase === 'finish'
          ? (legacyPhases.finish ?? legacyPhases.ship)
          : legacyPhases[phase];
      return [phase, isPhaseStatus(status) ? status : undefined];
    }),
  ) as Record<WorkflowPhase, PhaseStatus | undefined>;
  if (!WORKFLOW_PHASES.every((phase) => phases[phase])) return undefined;

  return {
    ...candidate,
    committedTasks: migratedCommittedTasks,
    autoPendingAction,
    current,
    phases: phases as Record<WorkflowPhase, PhaseStatus>,
    warnings: candidate.warnings,
  };
}

export function parsePersistedWorkflowState(
  value: unknown,
): WorkflowState | undefined {
  const directState = coerceWorkflowState(value);
  if (directState) return parseWorkflowState(directState);

  if (typeof value !== 'string') return undefined;

  try {
    const parsed = JSON.parse(value);
    const parsedState =
      parsed?.type === WORKFLOW_STATE_ENTRY_TYPE
        ? coerceWorkflowState(parsed.state)
        : coerceWorkflowState(parsed);
    if (parsedState) return parseWorkflowState(parsedState);
  } catch {
    return undefined;
  }

  return undefined;
}

export function workflowStateFromEntry(
  entry: WorkflowStateEntry,
): WorkflowState | undefined {
  if (Array.isArray(entry)) {
    const [type, data] = entry;
    return type === WORKFLOW_STATE_ENTRY_TYPE
      ? parsePersistedWorkflowState(data)
      : undefined;
  }

  if (entry.type === 'custom' && entry.customType === WORKFLOW_STATE_ENTRY_TYPE)
    return parsePersistedWorkflowState(entry.data);
  if (entry.type === WORKFLOW_STATE_ENTRY_TYPE)
    return parsePersistedWorkflowState(entry.data);

  return undefined;
}

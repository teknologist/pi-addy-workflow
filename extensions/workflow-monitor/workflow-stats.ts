import {
  type WorkflowEvent,
  type WorkflowIssueStats,
  type WorkflowPhase,
  type WorkflowState,
  type WorkflowStats,
  type WorkflowStatsSession,
  type WorkflowTaskStats,
} from './workflow-transitions.ts';
import { commandNameFromText, isManualTurnCommand } from './command-router.ts';
import {
  taskIdForIdentity,
  workflowTaskIdentityKey,
} from './workflow-task-identity.ts';

export type WorkflowStatsTarget = {
  plan?: string;
  taskId?: string;
  sliceIndex?: number;
  taskIndex?: number;
  taskTitle?: string;
};

export function emptyIssueStats(): WorkflowIssueStats {
  return { critical: 0, important: 0, suggestion: 0, unknown: 0, total: 0 };
}

export function addIssueStats(
  left: WorkflowIssueStats,
  right: WorkflowIssueStats,
): WorkflowIssueStats {
  return {
    critical: left.critical + right.critical,
    important: left.important + right.important,
    suggestion: left.suggestion + right.suggestion,
    unknown: left.unknown + right.unknown,
    total: left.total + right.total,
  };
}

export function createEmptyWorkflowStats(): WorkflowStats {
  return { active: { tasks: {} }, history: [] };
}

function normalizeIssueStats(value: unknown): WorkflowIssueStats {
  if (typeof value !== 'object' || value === null) return emptyIssueStats();
  const candidate = value as Partial<WorkflowIssueStats>;
  const nonNegative = (number: unknown) =>
    typeof number === 'number' && Number.isSafeInteger(number) && number >= 0
      ? number
      : 0;
  return {
    critical: nonNegative(candidate.critical),
    important: nonNegative(candidate.important),
    suggestion: nonNegative(candidate.suggestion),
    unknown: nonNegative(candidate.unknown),
    total: nonNegative(candidate.total),
  };
}

function normalizeTaskStats(value: unknown): WorkflowTaskStats | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const candidate = value as Partial<WorkflowTaskStats>;
  const nonNegative = (number: unknown) =>
    typeof number === 'number' && Number.isSafeInteger(number) && number >= 0
      ? number
      : 0;
  return {
    plan: typeof candidate.plan === 'string' ? candidate.plan : undefined,
    taskId: typeof candidate.taskId === 'string' ? candidate.taskId : undefined,
    sliceIndex:
      typeof candidate.sliceIndex === 'number' &&
      Number.isSafeInteger(candidate.sliceIndex) &&
      candidate.sliceIndex > 0
        ? candidate.sliceIndex
        : undefined,
    taskIndex:
      typeof candidate.taskIndex === 'number' &&
      Number.isSafeInteger(candidate.taskIndex) &&
      candidate.taskIndex > 0
        ? candidate.taskIndex
        : undefined,
    taskTitle:
      typeof candidate.taskTitle === 'string' ? candidate.taskTitle : undefined,
    startedAt:
      typeof candidate.startedAt === 'string' ? candidate.startedAt : undefined,
    finishedAt:
      typeof candidate.finishedAt === 'string'
        ? candidate.finishedAt
        : undefined,
    activePhase: normalizePhase(candidate.activePhase),
    phaseStartedAt:
      typeof candidate.phaseStartedAt === 'string'
        ? candidate.phaseStartedAt
        : undefined,
    phaseDurationsMs: normalizePhaseDurations(candidate.phaseDurationsMs),
    turns: nonNegative(candidate.turns),
    verifyRuns: nonNegative(candidate.verifyRuns),
    reviewRuns: nonNegative(candidate.reviewRuns),
    issues: normalizeIssueStats(candidate.issues),
  };
}

const TIMED_PHASES = new Set<WorkflowPhase>([
  'build',
  'simplify',
  'verify',
  'review',
  'finish',
]);

function normalizePhase(value: unknown): WorkflowPhase | undefined {
  return typeof value === 'string' && TIMED_PHASES.has(value as WorkflowPhase)
    ? (value as WorkflowPhase)
    : undefined;
}

function normalizePhaseDurations(
  value: unknown,
): Partial<Record<WorkflowPhase, number>> | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const durations: Partial<Record<WorkflowPhase, number>> = {};
  for (const [phase, duration] of Object.entries(value)) {
    const normalizedPhase = normalizePhase(phase);
    if (
      normalizedPhase &&
      typeof duration === 'number' &&
      Number.isSafeInteger(duration) &&
      duration >= 0
    )
      durations[normalizedPhase] = duration;
  }
  return Object.keys(durations).length ? durations : undefined;
}

function normalizeStatsSession(value: unknown): WorkflowStatsSession {
  if (typeof value !== 'object' || value === null) return { tasks: {} };
  const candidate = value as Partial<WorkflowStatsSession>;
  const tasks: Record<string, WorkflowTaskStats> = {};
  if (typeof candidate.tasks === 'object' && candidate.tasks !== null) {
    for (const [key, task] of Object.entries(candidate.tasks)) {
      const normalized = normalizeTaskStats(task);
      if (normalized) tasks[key] = normalized;
    }
  }
  return {
    tasks,
    endedReason:
      typeof candidate.endedReason === 'string'
        ? candidate.endedReason
        : undefined,
  };
}

export function normalizeWorkflowStats(value: unknown): WorkflowStats {
  if (typeof value !== 'object' || value === null)
    return createEmptyWorkflowStats();
  const candidate = value as Partial<WorkflowStats>;
  return {
    active: normalizeStatsSession(candidate.active),
    history: Array.isArray(candidate.history)
      ? candidate.history.map(normalizeStatsSession)
      : [],
  };
}

function statsTaskKey(
  state: WorkflowState,
  target: WorkflowStatsTarget = {},
): string {
  const plan = target.plan ?? state.activePlan ?? '';
  return workflowTaskIdentityKey(
    {
      plan,
      taskId: taskIdForIdentity(target, [
        {
          taskId: state.currentTaskId,
          taskIndex: state.currentTaskIndex,
          taskTitle: state.currentTask,
        },
      ]),
      sliceIndex: target.sliceIndex ?? state.currentSliceIndex,
      taskIndex: target.taskIndex ?? state.currentTaskIndex,
      taskTitle: target.taskTitle ?? state.currentTask,
    },
    { includeSlice: true },
  );
}

function workflowStatsTarget(
  state: WorkflowState,
  target: WorkflowStatsTarget = {},
): Required<WorkflowStatsTarget> {
  return {
    plan: target.plan ?? state.activePlan ?? '',
    taskId:
      taskIdForIdentity(target, [
        {
          taskId: state.currentTaskId,
          taskIndex: state.currentTaskIndex,
          taskTitle: state.currentTask,
        },
      ]) ?? '',
    sliceIndex: target.sliceIndex ?? state.currentSliceIndex ?? 0,
    taskIndex: target.taskIndex ?? state.currentTaskIndex ?? 0,
    taskTitle: target.taskTitle ?? state.currentTask ?? '',
  };
}

function hasWorkflowStatsTarget(
  state: WorkflowState,
  target: WorkflowStatsTarget,
): boolean {
  return Boolean(
    state.activePlan || state.currentTask || target.plan || target.taskTitle,
  );
}

function emptyTaskStats(
  target: Required<WorkflowStatsTarget>,
): WorkflowTaskStats {
  return {
    plan: target.plan || undefined,
    taskId: target.taskId || undefined,
    sliceIndex: target.sliceIndex || undefined,
    taskIndex: target.taskIndex || undefined,
    taskTitle: target.taskTitle || undefined,
    startedAt: undefined,
    finishedAt: undefined,
    activePhase: undefined,
    phaseStartedAt: undefined,
    phaseDurationsMs: undefined,
    turns: 0,
    verifyRuns: 0,
    reviewRuns: 0,
    issues: emptyIssueStats(),
  };
}

function updateWorkflowTaskStats(
  state: WorkflowState,
  target: WorkflowStatsTarget,
  update: (existing: WorkflowTaskStats) => WorkflowTaskStats,
): WorkflowState {
  if (!hasWorkflowStatsTarget(state, target)) return state;

  const stats = state.stats ?? createEmptyWorkflowStats();
  const resolved = workflowStatsTarget(state, target);
  const key = statsTaskKey(state, target);
  const existing = stats.active.tasks[key] ?? emptyTaskStats(resolved);
  return {
    ...state,
    stats: {
      active: {
        ...stats.active,
        tasks: {
          ...stats.active.tasks,
          [key]: update(existing),
        },
      },
      history: stats.history,
    },
  };
}

export function recordWorkflowTaskTurn(
  state: WorkflowState,
  target: WorkflowStatsTarget = {},
  phase?: WorkflowPhase,
  now = new Date().toISOString(),
): WorkflowState {
  return updateWorkflowTaskStats(state, target, (existing) => ({
    ...startTaskStatsPhase(existing, phase, now),
    turns: existing.turns + 1,
  }));
}

function closeTaskStatsPhase(
  existing: WorkflowTaskStats,
  now: string,
): WorkflowTaskStats {
  const startedAt = existing.phaseStartedAt
    ? Date.parse(existing.phaseStartedAt)
    : NaN;
  const endedAt = Date.parse(now);
  if (
    !existing.activePhase ||
    !Number.isFinite(startedAt) ||
    !Number.isFinite(endedAt)
  )
    return existing;
  const elapsed = Math.max(0, endedAt - startedAt);
  return {
    ...existing,
    phaseDurationsMs: {
      ...existing.phaseDurationsMs,
      [existing.activePhase]:
        (existing.phaseDurationsMs?.[existing.activePhase] ?? 0) + elapsed,
    },
  };
}

function startTaskStatsPhase(
  existing: WorkflowTaskStats,
  phase: WorkflowPhase | undefined,
  now: string,
): WorkflowTaskStats {
  const base = { ...existing, startedAt: existing.startedAt ?? now };
  if (!phase || !TIMED_PHASES.has(phase)) return base;
  if (existing.activePhase === phase && existing.phaseStartedAt) return base;
  const closed = closeTaskStatsPhase(base, now);
  return { ...closed, activePhase: phase, phaseStartedAt: now };
}

export function recordWorkflowTaskFinished(
  state: WorkflowState,
  target: WorkflowStatsTarget = {},
  finishedAt = new Date().toISOString(),
): WorkflowState {
  return updateWorkflowTaskStats(state, target, (existing) => ({
    ...closeTaskStatsPhase(existing, finishedAt),
    startedAt: existing.startedAt ?? finishedAt,
    finishedAt,
    activePhase: undefined,
    phaseStartedAt: undefined,
  }));
}

export function recordWorkflowVerifyRun(
  state: WorkflowState,
  target: WorkflowStatsTarget = {},
  now = new Date().toISOString(),
): WorkflowState {
  const withTurn = recordWorkflowTaskTurn(state, target, 'verify', now);
  const key = statsTaskKey(withTurn, target);
  const stats = withTurn.stats ?? createEmptyWorkflowStats();
  const existing = stats.active.tasks[key];
  if (!existing) return withTurn;

  return {
    ...withTurn,
    stats: {
      active: {
        ...stats.active,
        tasks: {
          ...stats.active.tasks,
          [key]: {
            ...existing,
            verifyRuns: (existing.verifyRuns ?? 0) + 1,
          },
        },
      },
      history: stats.history,
    },
  };
}

export function recordWorkflowReviewRun(
  state: WorkflowState,
  target: WorkflowStatsTarget = {},
  now = new Date().toISOString(),
): WorkflowState {
  const withTurn = recordWorkflowTaskTurn(state, target, 'review', now);
  const key = statsTaskKey(withTurn, target);
  const stats = withTurn.stats ?? createEmptyWorkflowStats();
  const existing = stats.active.tasks[key];
  if (!existing) return withTurn;

  return {
    ...withTurn,
    reviewStatsKey: key,
    stats: {
      active: {
        ...stats.active,
        tasks: {
          ...stats.active.tasks,
          [key]: {
            ...existing,
            reviewRuns: (existing.reviewRuns ?? 0) + 1,
          },
        },
      },
      history: stats.history,
    },
  };
}

export function recordWorkflowReviewIssues(
  state: WorkflowState,
  issues: WorkflowIssueStats,
): WorkflowState {
  const key = state.reviewStatsKey;
  if (!key) return state;

  const stats = state.stats ?? createEmptyWorkflowStats();
  const existing = stats.active.tasks[key];
  if (!existing)
    return { ...state, reviewStatsKey: undefined, reviewStatsAgent: undefined };

  return {
    ...state,
    reviewStatsKey: undefined,
    reviewStatsAgent: undefined,
    stats: {
      active: {
        ...stats.active,
        tasks: {
          ...stats.active.tasks,
          [key]: {
            ...existing,
            issues: addIssueStats(existing.issues, issues),
          },
        },
      },
      history: stats.history,
    },
  };
}

function reviewSubagentName(event: WorkflowEvent): string | undefined {
  if (event.source !== 'subagent-call') return undefined;
  if (!event.agentName?.startsWith('addy-')) return undefined;
  if (!event.agentName.includes('review')) return undefined;
  return event.agentName;
}

function recordReviewSubagentStats(
  state: WorkflowState,
  agentName: string,
): WorkflowState {
  if (state.reviewStatsKey) return { ...state, reviewStatsAgent: agentName };
  return { ...recordWorkflowReviewRun(state), reviewStatsAgent: agentName };
}

export function recordManualTaskTurn(
  previous: WorkflowState,
  state: WorkflowState,
  event: WorkflowEvent,
): WorkflowState {
  if (previous.autoMode) return state;
  const reviewAgent = reviewSubagentName(event);
  if (reviewAgent) return recordReviewSubagentStats(state, reviewAgent);
  if (event.source !== 'user-input' && event.source !== 'command') return state;
  const command = commandNameFromText(event.text ?? event.command);
  if (!isManualTurnCommand(command)) return state;
  if (command === '/addy-verify') return recordWorkflowVerifyRun(state);
  if (command === '/addy-review') return recordWorkflowReviewRun(state);
  return recordWorkflowTaskTurn(state, {}, phaseForStatsCommand(command));
}

export function phaseForStatsCommand(
  command: string | undefined,
): WorkflowPhase | undefined {
  if (command === '/addy-code-simplify') return 'simplify';
  if (command === '/addy-fix-all') return 'review';
  if (command === '/addy-build') return 'build';
  if (command === '/addy-finish') return 'finish';
  return undefined;
}

export function archiveWorkflowStats(
  state: WorkflowState,
  endedReason: string,
): WorkflowState {
  const stats = state.stats ?? createEmptyWorkflowStats();
  const hasActiveStats = Object.keys(stats.active.tasks).length > 0;
  return {
    ...state,
    stats: hasActiveStats
      ? {
          active: { tasks: {} },
          history: [...stats.history, { ...stats.active, endedReason }],
        }
      : stats,
  };
}

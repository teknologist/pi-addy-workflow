import {
  type WorkflowEvent,
  type WorkflowIssueStats,
  type WorkflowState,
  type WorkflowStats,
  type WorkflowStatsSession,
  type WorkflowTaskStats,
} from './workflow-transitions.ts';
import { commandNameFromText, isManualTurnCommand } from './command-router.ts';

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
    turns: nonNegative(candidate.turns),
    verifyRuns: nonNegative(candidate.verifyRuns),
    reviewRuns: nonNegative(candidate.reviewRuns),
    issues: normalizeIssueStats(candidate.issues),
  };
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
  const targetMatchesCurrentTask =
    (!target.taskIndex || target.taskIndex === state.currentTaskIndex) &&
    (!target.taskTitle || target.taskTitle === state.currentTask);
  const taskId =
    target.taskId ??
    (targetMatchesCurrentTask ? state.currentTaskId : undefined);
  if (taskId) return [plan, 'task-id', taskId].join('\u001f');

  return [
    plan,
    target.sliceIndex ?? state.currentSliceIndex ?? '',
    target.taskIndex ?? state.currentTaskIndex ?? '',
    target.taskTitle ?? state.currentTask ?? '',
  ].join('\u001f');
}

function workflowStatsTarget(
  state: WorkflowState,
  target: WorkflowStatsTarget = {},
): Required<WorkflowStatsTarget> {
  return {
    plan: target.plan ?? state.activePlan ?? '',
    taskId:
      target.taskId ??
      ((!target.taskIndex || target.taskIndex === state.currentTaskIndex) &&
      (!target.taskTitle || target.taskTitle === state.currentTask)
        ? (state.currentTaskId ?? '')
        : ''),
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
): WorkflowState {
  return updateWorkflowTaskStats(state, target, (existing) => ({
    ...existing,
    turns: existing.turns + 1,
  }));
}

export function recordWorkflowVerifyRun(
  state: WorkflowState,
  target: WorkflowStatsTarget = {},
): WorkflowState {
  const withTurn = recordWorkflowTaskTurn(state, target);
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
): WorkflowState {
  const withTurn = recordWorkflowTaskTurn(state, target);
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
  return recordWorkflowTaskTurn(state);
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

function totalStatsTasks(
  session: WorkflowStatsSession,
  planPath?: string,
): WorkflowTaskStats[] {
  return Object.values(session.tasks).filter(
    (task) => !planPath || task.plan === planPath,
  );
}

function sumTaskStats(tasks: WorkflowTaskStats[]): {
  turns: number;
  verifyRuns: number;
  reviewRuns: number;
  issues: WorkflowIssueStats;
} {
  return tasks.reduce(
    (total, task) => ({
      turns: total.turns + task.turns,
      verifyRuns: total.verifyRuns + task.verifyRuns,
      reviewRuns: total.reviewRuns + task.reviewRuns,
      issues: addIssueStats(total.issues, task.issues),
    }),
    { turns: 0, verifyRuns: 0, reviewRuns: 0, issues: emptyIssueStats() },
  );
}

function statsTaskIdentity(task: WorkflowTaskStats): string {
  if (task.taskId)
    return [task.plan ?? '', 'task-id', task.taskId].join('\u001f');

  return [
    task.plan ?? '',
    task.sliceIndex ?? '',
    task.taskIndex ?? '',
    task.taskTitle ?? '',
  ].join('\u001f');
}

function mergeTaskStats(tasks: WorkflowTaskStats[]): WorkflowTaskStats[] {
  const merged = new Map<string, WorkflowTaskStats>();
  for (const task of tasks) {
    const key = statsTaskIdentity(task);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...task, issues: { ...task.issues } });
      continue;
    }
    merged.set(key, {
      ...existing,
      turns: existing.turns + task.turns,
      verifyRuns: existing.verifyRuns + task.verifyRuns,
      reviewRuns: existing.reviewRuns + task.reviewRuns,
      issues: addIssueStats(existing.issues, task.issues),
    });
  }
  return [...merged.values()];
}

function renderTaskStatsLine(
  task: WorkflowTaskStats,
  current: boolean,
): string {
  const slice = task.sliceIndex ? `slice ${task.sliceIndex}, ` : '';
  const taskLabel = task.taskIndex ? `task ${task.taskIndex}` : 'task';
  const title = task.taskTitle ? `: ${task.taskTitle}` : '';
  return `${current ? 'Current' : 'Completed'} ${slice}${taskLabel}${title} — ${task.turns} turns, verify ${task.verifyRuns}, review ${task.reviewRuns}, issues ${task.issues.total}`;
}

function escapeMarkdownTableCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function renderTaskStatsMarkdownRow(
  task: WorkflowTaskStats,
  current: boolean,
): string {
  const scope = task.sliceIndex ? `Slice ${task.sliceIndex}` : '—';
  const taskLabel = [
    task.taskIndex ? `Task ${task.taskIndex}` : 'Task',
    task.taskTitle,
  ]
    .filter(Boolean)
    .join(': ');
  return `| ${current ? 'Current' : 'Completed'} | ${escapeMarkdownTableCell(scope)} | ${escapeMarkdownTableCell(taskLabel)} | ${task.turns} | ${task.verifyRuns} | ${task.reviewRuns} | ${task.issues.total} |`;
}

export function renderWorkflowStatsText(
  state: WorkflowState,
  planPath?: string,
): string {
  const stats = normalizeWorkflowStats(state.stats);
  const activeTasks = totalStatsTasks(stats.active, planPath);
  const historyTasks = stats.history.flatMap((session) =>
    totalStatsTasks(session, planPath),
  );
  const allTasks = [...activeTasks, ...historyTasks];
  if (allTasks.length === 0) return 'No Addy stats recorded yet';

  const totals = sumTaskStats(allTasks);
  const activeKeys = new Set(activeTasks.map(statsTaskIdentity));
  const lines = [
    'Addy stats',
    `Turns: ${totals.turns}`,
    `Verify runs: ${totals.verifyRuns}`,
    `Review runs: ${totals.reviewRuns}`,
    `Issues: ${totals.issues.total} (Critical ${totals.issues.critical}, Important ${totals.issues.important}, Suggestions ${totals.issues.suggestion}, Unknown ${totals.issues.unknown})`,
  ];

  for (const task of mergeTaskStats(allTasks)) {
    lines.push(
      renderTaskStatsLine(task, activeKeys.has(statsTaskIdentity(task))),
    );
  }

  return lines.join('\n');
}

export function renderWorkflowStatsMarkdown(
  state: WorkflowState,
  planPath?: string,
): string {
  const stats = normalizeWorkflowStats(state.stats);
  const activeTasks = totalStatsTasks(stats.active, planPath);
  const historyTasks = stats.history.flatMap((session) =>
    totalStatsTasks(session, planPath),
  );
  const allTasks = [...activeTasks, ...historyTasks];
  if (allTasks.length === 0)
    return '## Addy stats\n\nNo Addy stats recorded yet';

  const totals = sumTaskStats(allTasks);
  const activeKeys = new Set(activeTasks.map(statsTaskIdentity));
  const taskRows = mergeTaskStats(allTasks).map((task) =>
    renderTaskStatsMarkdownRow(task, activeKeys.has(statsTaskIdentity(task))),
  );

  return [
    '## Addy stats',
    '',
    '| Metric | Count |',
    '|---|---:|',
    `| Turns | ${totals.turns} |`,
    `| Verify runs | ${totals.verifyRuns} |`,
    `| Review runs | ${totals.reviewRuns} |`,
    `| Issues | ${totals.issues.total} |`,
    `| Critical | ${totals.issues.critical} |`,
    `| Important | ${totals.issues.important} |`,
    `| Suggestions | ${totals.issues.suggestion} |`,
    `| Unknown | ${totals.issues.unknown} |`,
    '',
    '| Status | Scope | Task | Turns | Verify | Review | Issues |',
    '|---|---|---|---:|---:|---:|---:|',
    ...taskRows,
  ].join('\n');
}

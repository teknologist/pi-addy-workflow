import {
  type WorkflowIssueStats,
  type WorkflowState,
  type WorkflowStatsSession,
  type WorkflowTaskStats,
} from './workflow-transitions.ts';
import {
  addIssueStats,
  emptyIssueStats,
  normalizeWorkflowStats,
} from './workflow-stats.ts';
import { workflowTaskIdentityKey } from './workflow-task-identity.ts';

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
  return workflowTaskIdentityKey(task, { includeSlice: true });
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

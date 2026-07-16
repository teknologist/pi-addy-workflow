import {
  WORKFLOW_PHASES,
  type WorkflowIssueStats,
  type WorkflowPhase,
  type WorkflowState,
  type WorkflowStatsSession,
  type WorkflowTaskStats,
  type WorkflowTicketStats,
} from './workflow-transitions.ts';
import { boundedTicketDisplay } from './ticket-presentation.ts';
import {
  addIssueStats,
  emptyIssueStats,
  normalizeWorkflowStats,
  workflowTaskDurationMs,
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
      startedAt: earliestIso(existing.startedAt, task.startedAt),
      finishedAt: latestIso(existing.finishedAt, task.finishedAt),
      phaseDurationsMs: addPhaseDurations(
        existing.phaseDurationsMs,
        task.phaseDurationsMs,
      ),
      turns: existing.turns + task.turns,
      verifyRuns: existing.verifyRuns + task.verifyRuns,
      reviewRuns: existing.reviewRuns + task.reviewRuns,
      issues: addIssueStats(existing.issues, task.issues),
    });
  }
  return [...merged.values()];
}

function earliestIso(
  left: string | undefined,
  right: string | undefined,
): string | undefined {
  if (!left) return right;
  if (!right) return left;
  return Date.parse(left) <= Date.parse(right) ? left : right;
}

function latestIso(
  left: string | undefined,
  right: string | undefined,
): string | undefined {
  if (!left) return right;
  if (!right) return left;
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

function addPhaseDurations(
  left: WorkflowTaskStats['phaseDurationsMs'],
  right: WorkflowTaskStats['phaseDurationsMs'],
): WorkflowTaskStats['phaseDurationsMs'] {
  if (!left && !right) return undefined;
  const durations: WorkflowTaskStats['phaseDurationsMs'] = { ...left };
  for (const phase of WORKFLOW_PHASES)
    durations[phase] = (durations[phase] ?? 0) + (right?.[phase] ?? 0);
  return durations;
}

function renderTaskStatsLine(
  task: WorkflowTaskStats,
  current: boolean,
): string {
  const slice = task.sliceIndex ? `slice ${task.sliceIndex}, ` : '';
  const taskLabel = task.taskIndex ? `task ${task.taskIndex}` : 'task';
  const title = task.taskTitle ? `: ${task.taskTitle}` : '';
  return `${current ? 'Current' : 'Completed'} ${slice}${taskLabel}${title} — ${task.turns} turns, verify ${task.verifyRuns}, review ${task.reviewRuns}, issues ${task.issues.total}, duration ${taskDuration(task)}, steps ${taskStepDurations(task)}`;
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
  return `| ${current ? 'Current' : 'Completed'} | ${escapeMarkdownTableCell(scope)} | ${escapeMarkdownTableCell(taskLabel)} | ${task.turns} | ${task.verifyRuns} | ${task.reviewRuns} | ${task.issues.total} | ${taskDuration(task)} | ${escapeMarkdownTableCell(taskStepDurations(task))} |`;
}

function durationFromMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return 'unknown';
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [
    hours ? `${hours}h` : undefined,
    minutes || hours ? `${minutes}m` : undefined,
    `${seconds}s`,
  ]
    .filter(Boolean)
    .join(' ');
}

function taskDuration(task: WorkflowTaskStats): string {
  const duration = workflowTaskDurationMs(task);
  return duration === undefined ? '—' : durationFromMs(duration);
}

const TIMED_PHASES = WORKFLOW_PHASES.filter((phase): phase is WorkflowPhase =>
  ['build', 'simplify', 'verify', 'review', 'finish'].includes(phase),
);

function taskStepDurations(task: WorkflowTaskStats): string {
  const parts = TIMED_PHASES.map((phase) => {
    const duration = task.phaseDurationsMs?.[phase];
    return duration ? `${phase} ${durationFromMs(duration)}` : undefined;
  }).filter(Boolean);
  return parts.length ? parts.join(', ') : '—';
}

export type WorkflowStatsFilter =
  | string
  | {
      kind: 'ticket';
      source: { kind: 'github' | 'linear' | 'local'; ref: string };
    };

function ticketStats(
  state: WorkflowState,
  source: { kind: 'github' | 'linear' | 'local'; ref: string },
): WorkflowTicketStats[] {
  const stats = normalizeWorkflowStats(state.stats);
  return [stats.active, ...stats.history].flatMap((session) =>
    Object.values(session.tickets ?? {}).filter(
      (ticket) =>
        ticket.target.source.kind === source.kind &&
        ticket.target.source.ref === source.ref,
    ),
  );
}

function ticketDuration(ticket: WorkflowTicketStats): number {
  return Object.values(ticket.phaseDurationsMs ?? {}).reduce(
    (sum, duration) => sum + duration,
    0,
  );
}

function renderTicketStatsText(
  state: WorkflowState,
  source: { kind: 'github' | 'linear' | 'local'; ref: string },
): string {
  const tickets = ticketStats(state, source);
  const display = `${source.kind}:${boundedTicketDisplay(source.ref)}`;
  if (!tickets.length) return `No Addy stats recorded for Ticket ${display}`;
  const totals = tickets.reduce(
    (sum, ticket) => ({
      turns: sum.turns + ticket.turns,
      verifyRuns: sum.verifyRuns + ticket.verifyRuns,
      reviewRuns: sum.reviewRuns + ticket.reviewRuns,
      fixRuns: sum.fixRuns + ticket.fixRuns,
      findings: sum.findings + ticket.findings,
      duration: sum.duration + ticketDuration(ticket),
    }),
    {
      turns: 0,
      verifyRuns: 0,
      reviewRuns: 0,
      fixRuns: 0,
      findings: 0,
      duration: 0,
    },
  );
  return [
    'Addy Ticket stats',
    `Ticket ${display}`,
    `Turns: ${totals.turns}`,
    `Verify runs: ${totals.verifyRuns}`,
    `Review runs: ${totals.reviewRuns}`,
    `Fix-all runs: ${totals.fixRuns}`,
    `Findings: ${totals.findings}`,
    `Duration: ${durationFromMs(totals.duration)}`,
  ].join('\n');
}

function renderTicketStatsMarkdown(
  state: WorkflowState,
  source: { kind: 'github' | 'linear' | 'local'; ref: string },
): string {
  const text = renderTicketStatsText(state, source);
  if (text.startsWith('No Addy stats'))
    return `## Addy Ticket stats\n\n${text}`;
  const lines = text.split('\n');
  return ['## Addy Ticket stats', '', ...lines.slice(1)].join('\n');
}

export function renderWorkflowStatsText(
  state: WorkflowState,
  filter?: WorkflowStatsFilter,
): string {
  if (typeof filter === 'object')
    return renderTicketStatsText(state, filter.source);
  const planPath = filter;
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
  filter?: WorkflowStatsFilter,
): string {
  if (typeof filter === 'object')
    return renderTicketStatsMarkdown(state, filter.source);
  const planPath = filter;
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
    '| Status | Scope | Task | Turns | Verify | Review | Issues | Duration | Steps |',
    '|---|---|---|---:|---:|---:|---:|---:|---|',
    ...taskRows,
  ].join('\n');
}

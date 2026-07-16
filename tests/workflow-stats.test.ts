import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createInitialWorkflowState,
  type WorkflowState,
} from '../extensions/workflow-monitor/workflow-transitions.ts';
import { handleWorkflowEvent } from '../extensions/workflow-monitor/workflow-handler.ts';
import {
  parsePersistedWorkflowState,
  serializeWorkflowState,
} from '../extensions/workflow-monitor/workflow-state.ts';
import {
  archiveWorkflowStats,
  createEmptyWorkflowStats,
  recordWorkflowReviewIssues,
  recordWorkflowReviewRun,
  recordWorkflowTaskFinished,
  recordWorkflowTaskTurn,
  recordWorkflowVerifyRun,
  recordValidatedTicketAttempt,
} from '../extensions/workflow-monitor/workflow-stats.ts';
import {
  renderWorkflowStatsMarkdown,
  renderWorkflowStatsText,
} from '../extensions/workflow-monitor/workflow-stats-report.ts';

const stateDir = mkdtempSync(join(tmpdir(), 'pi-addy-workflow-stats-test-'));

test('Ticket stats use stable source identity and deduplicate validated attempts', () => {
  const base = createInitialWorkflowState();
  const source = { kind: 'linear' as const, ref: 'ENG-42' };
  const reviewed = recordValidatedTicketAttempt(
    base,
    { kind: 'ticket', source },
    {
      operation: 'review',
      outcome: 'succeeded',
      actionKey: 'review-key',
      attempt: 1,
      findings: 3,
    },
    '2026-07-15T10:00:00.000Z',
    '2026-07-15T10:02:00.000Z',
  );
  const duplicate = recordValidatedTicketAttempt(
    reviewed,
    { kind: 'ticket', source },
    {
      operation: 'review',
      outcome: 'succeeded',
      actionKey: 'review-key',
      attempt: 1,
      findings: 3,
    },
  );
  const fixed = recordValidatedTicketAttempt(
    duplicate,
    { kind: 'ticket', source },
    {
      operation: 'fix-all',
      outcome: 'reconciled',
      actionKey: 'fix-key',
      attempt: 1,
    },
    '2026-07-15T10:02:00.000Z',
    '2026-07-15T10:03:00.000Z',
  );

  const ticket = Object.values(fixed.stats?.active.tickets ?? {})[0];
  assert.equal(Object.keys(fixed.stats?.active.tickets ?? {}).length, 1);
  assert.equal(ticket.reviewRuns, 1);
  assert.equal(ticket.fixRuns, 1);
  assert.equal(ticket.findings, 3);
  assert.equal(ticket.turns, 2);
  assert.equal(ticket.phaseDurationsMs?.review, 120_000);
  assert.equal(ticket.phaseDurationsMs?.['fix-all'], 60_000);
  assert.match(
    renderWorkflowStatsText(fixed, { kind: 'ticket', source }),
    /Ticket linear:ENG-42/,
  );
  const persisted = parsePersistedWorkflowState(serializeWorkflowState(fixed));
  assert.equal(
    Object.values(persisted?.stats?.active.tickets ?? {})[0]?.findings,
    3,
  );
});

test('Ticket stats filter by full source identity across trackers', () => {
  const base = createInitialWorkflowState();
  const github = recordValidatedTicketAttempt(
    base,
    {
      kind: 'ticket',
      source: { kind: 'github', ref: '42' },
    },
    {
      operation: 'verify',
      outcome: 'succeeded',
      actionKey: 'github-verify',
      attempt: 1,
    },
  );
  const both = recordValidatedTicketAttempt(
    github,
    {
      kind: 'ticket',
      source: { kind: 'linear', ref: '42' },
    },
    {
      operation: 'review',
      outcome: 'succeeded',
      actionKey: 'linear-review',
      attempt: 1,
    },
  );

  const rendered = renderWorkflowStatsText(both, {
    kind: 'ticket',
    source: { kind: 'github', ref: '42' },
  });
  assert.match(rendered, /Ticket github:42/);
  assert.match(rendered, /Verify runs: 1/);
  assert.match(rendered, /Review runs: 0/);
});

test('workflow stats records verify review issues and archives active tasks', () => {
  const state = {
    ...createInitialWorkflowState(),
    activePlan: 'docs/plans/current.md',
    currentTask: 'Stats task',
    currentTaskIndex: 1,
  };

  const reviewed = recordWorkflowReviewIssues(
    recordWorkflowReviewRun(recordWorkflowVerifyRun(state)),
    { critical: 1, important: 2, suggestion: 3, unknown: 4, total: 10 },
  );
  const statsText = renderWorkflowStatsText(reviewed);
  const statsMarkdown = renderWorkflowStatsMarkdown(reviewed);

  assert.match(statsText, /Turns: 2/);
  assert.match(statsText, /Verify runs: 1/);
  assert.match(statsText, /Review runs: 1/);
  assert.match(statsText, /Issues: 10/);
  assert.match(statsMarkdown, /\| Issues \| 10 \|/);
  assert.equal(reviewed.reviewStatsKey, undefined);

  const archived = archiveWorkflowStats(reviewed, 'completed');
  assert.deepEqual(archived.stats?.active.tasks, {});
  assert.equal(archived.stats?.history.at(-1)?.endedReason, 'completed');
  assert.equal(
    Object.values(archived.stats?.history.at(-1)?.tasks ?? {})[0].turns,
    2,
  );
});

test('workflow stats records task duration and per-step timings', () => {
  const state = {
    ...createInitialWorkflowState(),
    activePlan: 'docs/plans/current.md',
    currentTask: 'Timed task',
    currentTaskIndex: 1,
  };

  const built = recordWorkflowTaskTurn(
    state,
    {},
    'build',
    '2026-05-27T10:00:00.000Z',
  );
  const verified = recordWorkflowVerifyRun(
    built,
    {},
    '2026-05-27T10:03:00.000Z',
  );
  const finished = recordWorkflowTaskFinished(
    verified,
    {},
    '2026-05-27T10:05:00.000Z',
  );

  const task = Object.values(finished.stats?.active.tasks ?? {})[0];
  assert.equal(task.startedAt, '2026-05-27T10:00:00.000Z');
  assert.equal(task.finishedAt, '2026-05-27T10:05:00.000Z');
  assert.equal(task.phaseDurationsMs?.build, 180_000);
  assert.equal(task.phaseDurationsMs?.verify, 120_000);
  assert.match(renderWorkflowStatsText(finished), /duration 5m 0s/);
  assert.match(renderWorkflowStatsText(finished), /build 3m 0s/);
  assert.match(
    renderWorkflowStatsMarkdown(finished),
    /\| Duration \| Steps \|/,
  );
});

test('workflow stats excludes idle time between stopped and resumed task work', () => {
  const state = {
    ...createInitialWorkflowState(),
    activePlan: 'docs/plans/current.md',
    currentTaskId: 'task-1',
    currentTask: 'Paused task',
    currentTaskIndex: 1,
  };

  const firstRun = recordWorkflowTaskFinished(
    recordWorkflowTaskTurn(state, {}, 'build', '2026-05-27T10:00:00.000Z'),
    {},
    '2026-05-27T10:05:00.000Z',
  );
  const stopped = archiveWorkflowStats(firstRun, 'stopped');
  const resumed = recordWorkflowTaskFinished(
    recordWorkflowVerifyRun(stopped, {}, '2026-05-27T10:15:00.000Z'),
    {},
    '2026-05-27T10:20:00.000Z',
  );

  const statsText = renderWorkflowStatsText(resumed);
  assert.match(statsText, /duration 10m 0s/);
  assert.doesNotMatch(statsText, /duration 20m 0s/);
  assert.match(statsText, /build 5m 0s, verify 5m 0s/);
});

test('workflow stats normalizes empty state for rendering', () => {
  assert.deepEqual(createEmptyWorkflowStats(), {
    active: { tasks: {} },
    history: [],
  });
  assert.equal(
    renderWorkflowStatsText({
      ...createInitialWorkflowState(),
      stats: undefined,
    }),
    'No Addy stats recorded yet',
  );
});

test('workflow stats aggregates renamed tasks by stable task id', () => {
  const state = {
    ...createInitialWorkflowState(),
    stats: {
      active: {
        tasks: {
          'old-key': {
            plan: 'docs/plans/current.md',
            taskId: 'task-k7p4x9',
            taskIndex: 1,
            taskTitle: 'Original title',
            turns: 1,
            verifyRuns: 1,
            reviewRuns: 0,
            issues: {
              critical: 0,
              important: 0,
              suggestion: 0,
              unknown: 0,
              total: 0,
            },
          },
        },
      },
      history: [
        {
          tasks: {
            'new-key': {
              plan: 'docs/plans/current.md',
              taskId: 'task-k7p4x9',
              taskIndex: 1,
              taskTitle: 'Renamed title',
              turns: 2,
              verifyRuns: 0,
              reviewRuns: 1,
              issues: {
                critical: 0,
                important: 1,
                suggestion: 0,
                unknown: 0,
                total: 1,
              },
            },
          },
          endedReason: 'task-commit',
        },
      ],
    },
  };

  const statsText = renderWorkflowStatsText(state);
  const statsMarkdown = renderWorkflowStatsMarkdown(state);

  assert.equal(statsText.match(/task 1:/g)?.length, 1);
  assert.match(statsText, /Turns: 3/);
  assert.match(statsText, /Verify runs: 1/);
  assert.match(statsText, /Review runs: 1/);
  assert.equal(statsMarkdown.match(/\| Current \|/g)?.length, 1);
  assert.match(
    statsMarkdown,
    /\| Current \| — \| Task 1: Original title \| 3 \| 1 \| 1 \| 1 \|/,
  );
});

test('workflow handler records manual task turns through Stats Module', () => {
  const cwd = join(stateDir, 'handler-stats-project');
  const planPath = join('docs', 'plans', 'stats.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Count through handler',
      '- [x] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
    { flag: 'w' },
  );
  const ctx: { cwd: string; state: WorkflowState } = {
    cwd,
    state: {
      ...createInitialWorkflowState(),
      current: 'build' as const,
      activePlan: planPath,
      currentTask: 'Count through handler',
      currentTaskIndex: 1,
      stats: createEmptyWorkflowStats(),
    },
  };

  const next = handleWorkflowEvent(ctx, {
    source: 'user-input',
    text: `/addy-verify ${planPath}`,
  });

  const task = Object.values(next.stats?.active.tasks ?? {})[0];
  assert.equal(task.taskTitle, 'Count through handler');
  assert.equal(task.turns, 1);
  assert.equal(task.verifyRuns, 1);
});

test('workflow handler records renamed manual task stats by stable task id', () => {
  const cwd = join(stateDir, 'handler-renamed-stats-project');
  const planPath = join('docs', 'plans', 'stats-renamed.md');
  const fullPlanPath = join(cwd, planPath);
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    fullPlanPath,
    [
      '## Task 1: Original title',
      '<!-- addy-task-id: task-k7p4x9 -->',
      '- [x] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );
  const ctx: { cwd: string; state: WorkflowState } = {
    cwd,
    state: {
      ...createInitialWorkflowState(),
      current: 'build' as const,
      activePlan: planPath,
      currentTask: 'Original title',
      currentTaskIndex: 1,
      stats: createEmptyWorkflowStats(),
    },
  };

  ctx.state = handleWorkflowEvent(ctx, {
    source: 'user-input',
    text: `/addy-verify ${planPath}`,
  });
  writeFileSync(
    fullPlanPath,
    [
      '## Task 1: Renamed title',
      '<!-- addy-task-id: task-k7p4x9 -->',
      '- [x] Implemented',
      '- [x] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );
  ctx.state = handleWorkflowEvent(ctx, {
    source: 'user-input',
    text: `/addy-review ${planPath}`,
  });

  assert.equal(Object.keys(ctx.state.stats?.active.tasks ?? {}).length, 1);
  const task = Object.values(ctx.state.stats?.active.tasks ?? {})[0];
  assert.equal(task.taskId, 'task-k7p4x9');
  assert.equal(task.turns, 2);
  assert.equal(task.verifyRuns, 1);
  assert.equal(task.reviewRuns, 1);
  assert.equal(renderWorkflowStatsText(ctx.state).match(/task 1:/g)?.length, 1);
});

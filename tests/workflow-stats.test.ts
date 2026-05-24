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
  archiveWorkflowStats,
  createEmptyWorkflowStats,
  recordWorkflowReviewIssues,
  recordWorkflowReviewRun,
  recordWorkflowVerifyRun,
} from '../extensions/workflow-monitor/workflow-stats.ts';
import {
  renderWorkflowStatsMarkdown,
  renderWorkflowStatsText,
} from '../extensions/workflow-monitor/workflow-stats-report.ts';

const stateDir = mkdtempSync(join(tmpdir(), 'pi-addy-workflow-stats-test-'));

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

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import {
  dashboardSnapshot,
  type DashboardSnapshot,
} from '../extensions/workflow-monitor/dashboard-server.ts';
import {
  externalProgressProjectKey,
  externalProgressRunsDir,
  writeExternalProgressSnapshot,
} from '../extensions/workflow-monitor/external-progress.ts';
import {
  createInitialWorkflowState,
  transitionWorkflow,
} from '../extensions/workflow-monitor/workflow-transitions.ts';
import { workflowTaskCommitKey } from '../extensions/workflow-monitor/plan-task-lifecycle.ts';
import { serializeWorkflowState } from '../extensions/workflow-monitor/workflow-state.ts';
import { projectWorkflowStateKey } from '../extensions/workflow-monitor/workflow-state-store-scope.ts';

test('dashboard html preserves slice expansion state across refreshes', () => {
  const html = readFileSync(
    join(process.cwd(), 'extensions/workflow-monitor/dashboard-server.ts'),
    'utf8',
  );

  assert.match(html, /const sliceOpenState = new Map\(\);/);
  assert.match(html, /function captureSliceOpenState\(\)/);
  assert.match(html, /data-slice-key=/);
  assert.match(
    html,
    /captureSliceOpenState\(\);\n\s*setHtmlIfChanged\(\$\('slices'\)/,
  );
});

test('dashboard snapshot reads the project-scoped active plan state', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'pi-addy-dashboard-'));
  const stateDir = join(cwd, 'state');
  try {
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(join(cwd, 'plans'), { recursive: true });
    writeFileSync(
      join(cwd, 'plans', 'active.md'),
      ['- [x] Done task', '- [ ] Wire dashboard'].join('\n'),
      'utf8',
    );
    const key = projectWorkflowStateKey({ cwd });
    const baseState = createInitialWorkflowState();
    writeFileSync(
      join(stateDir, `${key}.json`),
      serializeWorkflowState({
        ...baseState,
        activePlan: 'plans/active.md',
        autoMode: true,
        current: 'build',
        phases: { ...baseState.phases, build: 'active' },
        currentTask: 'Wire dashboard',
        currentTaskIndex: 2,
        committedTasks: {
          [workflowTaskCommitKey('plans/active.md', 1, 'Done task')]: {
            plan: 'plans/active.md',
            taskIndex: 1,
            taskTitle: 'Done task',
            commitSha: 'abc1234',
            committedAt: '2026-05-27T18:00:00.000Z',
          },
        },
        stats: {
          active: {
            tasks: {
              wire: {
                plan: 'plans/active.md',
                taskId: 'wire',
                taskIndex: 2,
                taskTitle: 'Wire dashboard',
                startedAt: '2026-05-27T18:00:00.000Z',
                phaseDurationsMs: { build: 120_000, verify: 30_000 },
                turns: 3,
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
          history: [],
        },
      }),
      'utf8',
    );

    const snapshot = dashboardSnapshot({ cwd, stateDir }) as DashboardSnapshot;

    assert.equal(snapshot.activePlan, 'plans/active.md');
    assert.equal(snapshot.autoMode, true);
    assert.equal(snapshot.currentPhase, 'build');
    assert.deepEqual(
      snapshot.phases.find((phase) => phase.name === 'build'),
      { name: 'build', status: 'active' },
    );
    assert.deepEqual(snapshot.progress?.task, {
      current: 2,
      total: 2,
      percent: 100,
    });
    assert.equal(snapshot.tasks[0]?.taskTitle, 'Wire dashboard');
    assert.deepEqual(snapshot.tasks[0]?.phaseDurations, [
      { phase: 'build', ms: 120_000, duration: '2m 0s' },
      { phase: 'verify', ms: 30_000, duration: '30s' },
    ]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('dashboard projects issue workflows without changing empty dashboard data', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'pi-addy-dashboard-external-'));
  const stateDir = join(cwd, 'state');
  const homeDir = mkdtempSync(join(tmpdir(), 'pi-addy-dashboard-home-'));
  try {
    writeFileSync(join(cwd, 'README.md'), 'fixture\n', 'utf8');
    execFileSync('git', ['init'], { cwd, stdio: 'ignore' });
    const baseline = dashboardSnapshot({
      cwd,
      stateDir,
      externalProgressHomeDir: homeDir,
      externalProgressCacheMs: 0,
    }) as DashboardSnapshot;
    assert.deepEqual(Object.keys(baseline).sort(), [
      'activePlan',
      'activePlanDisplayName',
      'activeSuitePlan',
      'activeSuitePlanDisplayName',
      'activeTask',
      'autoMode',
      'autoPausedReason',
      'autoPendingAction',
      'currentPhase',
      'currentSliceIndex',
      'currentTask',
      'currentTaskId',
      'currentTaskIndex',
      'currentTaskSummary',
      'cwd',
      'nextTask',
      'nextTaskId',
      'nextTaskSummary',
      'phases',
      'planGroups',
      'progress',
      'sliceCount',
      'sliceGroups',
      'stateCount',
      'stateDir',
      'stateFile',
      'stateLastUpdatedAt',
      'taskCount',
      'tasks',
      'updatedAt',
      'warnings',
    ]);
    assert.equal('externalRuns' in baseline, false);
    assert.equal('externalProgressWarning' in baseline, false);

    const projectKey = externalProgressProjectKey({ cwd });
    const now = new Date().toISOString();
    const run = (overrides: Record<string, unknown>) => ({
      schemaVersion: 1,
      projectKey,
      source: 'df-implement-issues',
      status: 'running',
      loopPhase: 'implementation',
      startedAt: now,
      updatedAt: now,
      ...overrides,
    });
    writeExternalProgressSnapshot(
      run({
        runId: '11111111-1111-4111-8111-111111111111',
        currentItem: '<script>alert(1)</script>',
      }),
      { homeDir },
    );
    writeExternalProgressSnapshot(
      run({
        runId: '22222222-2222-4222-8222-222222222222',
        source: 'implement-from-issues',
        status: 'blocked',
        currentItem: 'Blocked <review>',
        startedAt: '2000-01-01T00:00:00.000Z',
        updatedAt: '2000-01-01T00:00:00.000Z',
      }),
      { homeDir },
    );
    writeExternalProgressSnapshot(
      run({
        runId: '33333333-3333-4333-8333-333333333333',
        status: 'completed',
        loopPhase: 'post-loop',
        currentItem: '<img src=x>',
        finishedAt: now,
      }),
      { homeDir },
    );
    writeExternalProgressSnapshot(
      run({
        runId: '44444444-4444-4444-8444-444444444444',
        status: 'failed',
        loopPhase: 'post-loop',
        currentItem: 'older terminal',
        startedAt: '2000-01-01T00:00:00.000Z',
        updatedAt: '2000-01-01T00:00:00.000Z',
        finishedAt: '2000-01-01T00:00:00.000Z',
      }),
      { homeDir },
    );
    writeFileSync(
      join(externalProgressRunsDir({ cwd, homeDir }), 'corrupt.json'),
      '{',
    );

    const snapshot = dashboardSnapshot({
      cwd,
      stateDir,
      externalProgressHomeDir: homeDir,
      externalProgressCacheMs: 0,
    }) as DashboardSnapshot;
    assert.deepEqual(
      snapshot.externalRuns?.map((entry) => entry.status),
      ['running', 'blocked', 'completed'],
    );
    assert.equal(snapshot.externalRuns?.[1]?.stale, true);
    assert.equal(
      snapshot.externalRuns?.[0]?.currentItem,
      '<script>alert(1)</script>',
    );
    assert.equal(
      snapshot.externalRuns?.some(
        (entry) => entry.currentItem === 'older terminal',
      ),
      false,
    );
    assert.equal('runId' in (snapshot.externalRuns?.[0] ?? {}), false);
    assert.equal(
      snapshot.externalProgressWarning,
      'Some issue workflow snapshots could not be read.',
    );

    const html = readFileSync(
      join(process.cwd(), 'extensions/workflow-monitor/dashboard-server.ts'),
      'utf8',
    );
    assert.match(html, /Issue workflows/);
    assert.match(html, /escapeHtml\(run\.currentItem\)/);
    assert.match(html, /externalProgressWarning/);
    assert.match(html, /const refreshIntervalMs = 5000/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test('dashboard snapshot shows finish active as soon as finish starts with warnings', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'pi-addy-dashboard-finish-'));
  const stateDir = join(cwd, 'state');
  try {
    mkdirSync(stateDir, { recursive: true });
    const key = projectWorkflowStateKey({ cwd });
    const build = transitionWorkflow(createInitialWorkflowState(), {
      source: 'user-input',
      text: '/addy-build plans/active.md',
    });
    const finish = transitionWorkflow(build, {
      source: 'user-input',
      text: '/addy-finish plans/active.md',
    });
    writeFileSync(
      join(stateDir, `${key}.json`),
      serializeWorkflowState(finish),
    );

    const snapshot = dashboardSnapshot({ cwd, stateDir }) as DashboardSnapshot;

    assert.equal(snapshot.currentPhase, 'finish');
    assert.deepEqual(
      snapshot.phases.find((phase) => phase.name === 'finish'),
      { name: 'finish', status: 'active' },
    );
    assert.match(snapshot.warnings[0] ?? '', /verify and review/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

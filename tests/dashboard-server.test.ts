import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  dashboardSnapshot,
  type DashboardSnapshot,
} from '../extensions/workflow-monitor/dashboard-server.ts';
import {
  createInitialWorkflowState,
  transitionWorkflow,
} from '../extensions/workflow-monitor/workflow-transitions.ts';
import { workflowTaskCommitKey } from '../extensions/workflow-monitor/plan-task-lifecycle.ts';
import { serializeWorkflowState } from '../extensions/workflow-monitor/workflow-state.ts';
import { projectWorkflowStateKey } from '../extensions/workflow-monitor/workflow-state-store-scope.ts';

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

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

test('dashboard html branches Ticket lifecycle and queue from plan-only chrome', () => {
  const html = readFileSync(
    join(process.cwd(), 'extensions/workflow-monitor/dashboard-server.ts'),
    'utf8',
  );

  assert.match(html, /if \(data\.ticket\) \{/);
  assert.match(html, /Ticket lifecycle/);
  assert.match(html, /Ticket queue/);
  assert.match(html, /escapeHtml\(ticket\.source\.ref\)/);
  assert.match(html, /escapeHtml\(ticket\.selector\.value\)/);
  assert.match(html, /planPicker.*hidden/);
  assert.match(html, /planChrome.*hidden/);
  assert.match(html, /planSlices.*hidden/);
  assert.match(html, /\} else \{[\s\S]*renderPlanPicker\(groups\)/);
});

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

test('dashboard snapshot projects only bounded Ticket presentation fields', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'pi-addy-dashboard-ticket-'));
  const stateDir = join(cwd, 'state');
  try {
    mkdirSync(stateDir, { recursive: true });
    const key = projectWorkflowStateKey({ cwd });
    const base = createInitialWorkflowState();
    writeFileSync(
      join(stateDir, `${key}.json`),
      serializeWorkflowState({
        ...base,
        executionSource: 'ticket',
        activePlan: 'must-not-be-read.md',
        current: 'review',
        currentTask: 'external progress must survive',
        currentTaskIndex: 2,
        taskCount: 4,
        currentSliceIndex: 1,
        sliceCount: 2,
        autoMode: true,
        autoPausedReason: 'ticket-operation-blocked',
        autoLastPrompt: 'raw prompt must not render',
        ticketQueue: {
          schemaVersion: 1,
          selector: { kind: 'label', value: 'A&B<script>' },
          drainId: 'drain-1',
        },
        ticketRun: {
          schemaVersion: 1,
          source: { kind: 'linear', ref: 'A&B<script>' },
          runId: 'run-1',
          claim: {
            id: 'claim-1',
            owner: 'secret owner',
            claimedAt: '2026-07-15T00:00:00.000Z',
          },
          lifecycle: { implemented: true, verified: true, reviewed: false },
          repositoryScope: ['.'],
        },
      }),
    );

    const snapshot = dashboardSnapshot({ cwd, stateDir });
    assert.deepEqual(snapshot.ticket?.lifecycle, {
      implemented: true,
      verified: true,
      reviewed: false,
    });
    assert.equal(snapshot.ticket?.frontier, 'review');
    assert.equal(snapshot.ticket?.claim, 'claimed');
    assert.equal(snapshot.ticket?.source.ref, 'A&B<script>');
    assert.equal(snapshot.ticket?.selector?.value, 'A&B<script>');
    assert.equal(snapshot.activePlan, 'must-not-be-read.md');
    assert.equal(snapshot.currentTask, 'external progress must survive');
    assert.deepEqual(snapshot.progress, {
      slice: { current: 1, total: 2, percent: 50 },
      task: { current: 2, total: 4, percent: 50 },
      totalTasks: undefined,
    });
    const encoded = JSON.stringify(snapshot.ticket);
    assert.doesNotMatch(
      encoded,
      /raw prompt|secret owner|repositoryScope|body|comments/,
    );
    assert.doesNotMatch(encoded, /\\n/);
    assert.ok((snapshot.ticket?.source.ref.length ?? 0) <= 121);
    assert.ok((snapshot.ticket?.selector?.value.length ?? 0) <= 121);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('dashboard snapshot keeps the no-Ticket shape unchanged', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'pi-addy-dashboard-legacy-shape-'));
  const stateDir = join(cwd, 'state');
  try {
    mkdirSync(stateDir, { recursive: true });
    const path = join(stateDir, `${projectWorkflowStateKey({ cwd })}.json`);
    const base = {
      ...createInitialWorkflowState(),
      activePlan: 'plans/active.md',
      currentTask: 'Keep bytes stable',
    };
    const bytes = () => {
      const snapshot = dashboardSnapshot({ cwd, stateDir });
      assert.equal(Object.hasOwn(snapshot, 'ticket'), false);
      return JSON.stringify({
        ...snapshot,
        updatedAt: '<time>',
        stateLastUpdatedAt: '<time>',
      });
    };

    writeFileSync(path, serializeWorkflowState(base));
    const before = bytes();
    writeFileSync(
      path,
      serializeWorkflowState({
        ...base,
        stats: {
          active: {
            tasks: {},
            tickets: {
              hidden: {
                target: {
                  kind: 'ticket',
                  source: { kind: 'github', ref: '42' },
                },
                turns: 1,
                verifyRuns: 0,
                reviewRuns: 0,
                fixRuns: 0,
                findings: 0,
                recordedAttempts: [],
              },
            },
          },
          history: [],
        },
      }),
    );
    assert.equal(bytes(), before);
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

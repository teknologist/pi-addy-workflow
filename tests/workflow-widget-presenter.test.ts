import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleWidth } from '@earendil-works/pi-tui';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createInitialWorkflowState,
  transitionWorkflow,
} from '../extensions/workflow-monitor/workflow-transitions.ts';
import {
  nextPromptForActivePlanLifecycle,
  refreshWorkflowTasksFromPlan,
  workflowTaskCommitKey,
} from '../extensions/workflow-monitor/workflow-tracker.ts';
import { parseWorkflowState } from '../extensions/workflow-monitor/workflow-state-codec.ts';
import {
  renderWorkflowStrip,
  renderWorkflowWidget,
} from '../extensions/workflow-monitor/workflow-widget-presenter.ts';
import {
  renderWorkflowStrip as renderWorkflowStripFromTracker,
  renderWorkflowWidget as renderWorkflowWidgetFromTracker,
} from '../extensions/workflow-monitor/workflow-tracker.ts';
import { expectedTotalTasksProgress } from './helpers.ts';

const taskFooterDir = '/tmp/pi-addy-workflow-task-footer-test';

function committedTasksFor(
  planPath: string,
  tasks: Array<{ taskIndex: number; taskTitle: string; sliceIndex?: number }>,
) {
  return Object.fromEntries(
    tasks.map((task) => [
      workflowTaskCommitKey(planPath, task.taskIndex, task.taskTitle),
      {
        plan: planPath,
        sliceIndex: task.sliceIndex,
        taskIndex: task.taskIndex,
        taskTitle: task.taskTitle,
        commitSha: 'abc1234',
        committedAt: '2026-05-21T00:00:00.000Z',
      },
    ]),
  );
}

test('workflow widget renders bounded Ticket facts without plan traversal', () => {
  const maliciousRef = `A&B<script>\n\x1b[31m${'x'.repeat(200)}`;
  const state = {
    ...createInitialWorkflowState(),
    executionSource: 'ticket' as const,
    activePlan: '/definitely/not/a/plan.md',
    current: 'verify' as const,
    ticketQueue: {
      schemaVersion: 1 as const,
      selector: {
        kind: 'label' as const,
        value: `ready<script>${'y'.repeat(200)}`,
      },
      drainId: 'drain-1',
    },
    ticketRun: {
      schemaVersion: 1 as const,
      source: { kind: 'github' as const, ref: maliciousRef },
      runId: 'run-1',
      claim: {
        id: 'claim-1',
        owner: 'owner',
        claimedAt: '2026-07-15T00:00:00.000Z',
      },
      queueSelector: {
        kind: 'label' as const,
        value: `ready<script>${'y'.repeat(200)}`,
      },
      lifecycle: { implemented: true, verified: false, reviewed: false },
      repositoryScope: ['.'],
      lastValidatedResult: {
        operation: 'build' as const,
        outcome: 'succeeded' as const,
        actionKey: 'key',
        attempt: 1,
      },
    },
  };

  const lines = renderWorkflowWidget(state)().render();
  assert.equal(lines.length, 2);
  assert.match(lines[1], /^Ticket: github:/);
  assert.match(lines[1], /Frontier: verify/);
  assert.match(lines[1], /Claim: claimed/);
  assert.match(lines[1], /Selector: label:/);
  assert.match(lines[1], /A&B<script>/);
  assert.doesNotMatch(
    lines.join('\n'),
    /Plan:|Current task:|\x1b\[31m|\n<script>/,
  );
  assert.ok(lines[1].length < 400);
});

test('workflow widget presenter renders phase strip', () => {
  const state = transitionWorkflow(createInitialWorkflowState(), {
    source: 'user-input',
    text: '/addy-plan',
  });

  assert.match(renderWorkflowStrip(state), /\[plan\]/);
});

test('workflow tracker keeps widget presenter compatibility exports', () => {
  const state = transitionWorkflow(createInitialWorkflowState(), {
    source: 'user-input',
    text: '/addy-plan docs/specs/feature.md',
  });

  assert.equal(
    renderWorkflowStripFromTracker(state),
    renderWorkflowStrip(state),
  );
  assert.deepEqual(
    renderWorkflowWidgetFromTracker(state)().render(),
    renderWorkflowWidget(state)().render(),
  );
});

test('workflow widget renders spec or plan name footer', () => {
  const specPath = 'docs/specs/2026-05-11-better-workflow.md';
  const planPath = 'docs/plans/2026-05-11-better-workflow.md';
  const state = transitionWorkflow(createInitialWorkflowState(), {
    source: 'user-input',
    text: `/addy-plan ${specPath}`,
  });
  assert.deepEqual(renderWorkflowWidget(state)().render(), [
    `Addy Workflow: define → [plan] => { build → simplify → verify → review → finish }`,
    `Spec: \x1b[1m2026-05-11-better-workflow.md\x1b[22m`,
  ]);

  const build = transitionWorkflow(
    { ...state, activePlan: planPath },
    { source: 'user-input', text: '/addy-build' },
  );
  assert.deepEqual(renderWorkflowWidget(build)().render(), [
    `Addy Workflow: ✓define → ✓plan => { [build] → simplify → verify → review → finish }`,
    `Plan: \x1b[1m2026-05-11-better-workflow.md\x1b[22m`,
  ]);
});

test('workflow widget hides task progress while plan phase is active', () => {
  const specPath = 'docs/specs/2026-05-11-better-workflow.md';
  const planPath = 'docs/plans/2026-05-11-better-workflow.md';
  const state = {
    ...createInitialWorkflowState(),
    current: 'plan' as const,
    phases: {
      ...createInitialWorkflowState().phases,
      define: 'complete' as const,
      plan: 'active' as const,
    },
    activeSpec: specPath,
    activePlan: planPath,
    currentTask: 'Add runtime modes',
    nextTask: 'Document producer contract',
    currentTaskIndex: 1,
    taskCount: 3,
    currentSliceIndex: 5,
    sliceCount: 5,
  };

  assert.deepEqual(renderWorkflowWidget(state)().render(), [
    `Addy Workflow: ✓define → [plan] => { build → simplify → verify → review → finish }`,
    `Spec: \x1b[1m2026-05-11-better-workflow.md\x1b[22m`,
  ]);
});

test('workflow widget renders current and next task from active plan', () => {
  const planPath = join(taskFooterDir, 'docs', 'plans', 'task-footer.md');
  mkdirSync(join(taskFooterDir, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    planPath,
    [
      '## Task 1: Existing import path',
      '- [x] Implemented',
      '- [x] Verified',
      '- [x] Reviewed',
      '',
      '## Task 2: Parse invoice rows',
      '- [x] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
      '',
      '## Task 3: Persist invoice payloads',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const state = refreshWorkflowTasksFromPlan(
    transitionWorkflow(
      {
        ...createInitialWorkflowState(),
        activePlan: planPath,
        committedTasks: committedTasksFor(planPath, [
          { taskIndex: 1, taskTitle: 'Existing import path' },
        ]),
      },
      { source: 'user-input', text: '/addy-build' },
    ),
  );

  assert.equal(state.currentTask, 'Parse invoice rows');
  assert.equal(state.nextTask, 'Persist invoice payloads');
  assert.deepEqual(renderWorkflowWidget(state)().render(), [
    'Addy Workflow: ✓define → ✓plan => { [build] → simplify → verify → review → finish }',
    'Plan: \x1b[1mtask-footer.md\x1b[22m',
    'Current task: Parse invoice rows | Next task: Persist invoice payloads | Task 2/3',
  ]);
});

test('workflow widget renders verify and review counts for the current task', () => {
  const state = {
    ...createInitialWorkflowState(),
    current: 'finish' as const,
    phases: {
      ...createInitialWorkflowState().phases,
      define: 'complete' as const,
      plan: 'complete' as const,
      build: 'complete' as const,
      verify: 'complete' as const,
      review: 'complete' as const,
      finish: 'active' as const,
    },
    activePlan: 'docs/plans/task-footer.md',
    currentTask: 'Parse invoice rows',
    nextTask: 'Persist invoice payloads',
    currentTaskIndex: 2,
    taskCount: 3,
    stats: {
      active: {
        tasks: {
          current: {
            plan: 'docs/plans/task-footer.md',
            taskIndex: 2,
            taskTitle: 'Parse invoice rows',
            turns: 7,
            verifyRuns: 2,
            reviewRuns: 3,
            issues: {
              critical: 0,
              important: 0,
              suggestion: 0,
              unknown: 0,
              total: 0,
            },
          },
          other: {
            plan: 'docs/plans/task-footer.md',
            taskIndex: 1,
            taskTitle: 'Previous task',
            turns: 4,
            verifyRuns: 5,
            reviewRuns: 6,
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
  };

  assert.deepEqual(renderWorkflowWidget(state)().render(), [
    'Addy Workflow: ✓define → ✓plan => { ✓build → simplify → ✓verify (2) → ✓review (3) → [finish] }',
    'Plan: \x1b[1mtask-footer.md\x1b[22m',
    'Current task: Parse invoice rows | Next task: Persist invoice payloads | Task 2/3',
  ]);
});

test('workflow widget resolves index plans to the first unfinished slice', () => {
  const cwd = join(taskFooterDir, 'index-plan-project');
  const plansDir = join(cwd, 'docs', 'plans');
  mkdirSync(plansDir, { recursive: true });
  writeFileSync(
    join(plansDir, '2026-05-14-migration-index.md'),
    [
      '# Migration Plan Index',
      '',
      '| Slice | File |',
      '| --- | --- |',
      '| 01 | `docs/plans/2026-05-14-migration-slice-01-api.md` |',
      '| 02 | `docs/plans/2026-05-14-migration-slice-02-runtime.md` |',
    ].join('\n'),
  );
  writeFileSync(
    join(plansDir, '2026-05-14-migration-slice-01-api.md'),
    [
      '## Task 1: Complete public API',
      '- [x] Implemented',
      '- [x] Verified',
      '- [x] Reviewed',
    ].join('\n'),
  );
  writeFileSync(
    join(plansDir, '2026-05-14-migration-slice-02-runtime.md'),
    [
      '## Task 1: Migrate runtime',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
      '',
      '## Task 2: Remove stale config',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const state = refreshWorkflowTasksFromPlan(
    {
      ...createInitialWorkflowState(),
      current: 'build',
      phases: {
        ...createInitialWorkflowState().phases,
        define: 'complete',
        plan: 'complete',
        build: 'active',
      },
      activePlan: '@docs/plans/2026-05-14-migration-index.md',
      committedTasks: committedTasksFor(
        '@docs/plans/2026-05-14-migration-slice-01-api.md',
        [{ taskIndex: 1, taskTitle: 'Complete public API', sliceIndex: 1 }],
      ),
    },
    cwd,
  );

  assert.equal(
    state.activePlan,
    '@docs/plans/2026-05-14-migration-slice-02-runtime.md',
  );
  assert.equal(state.currentTask, 'Migrate runtime');
  assert.equal(
    nextPromptForActivePlanLifecycle(
      { ...state, activePlan: '@docs/plans/2026-05-14-migration-index.md' },
      cwd,
    ),
    '/addy-build @docs/plans/2026-05-14-migration-slice-02-runtime.md',
  );
  assert.deepEqual(renderWorkflowWidget(state, cwd)().render(), [
    'Addy Workflow: ✓define → ✓plan => { [build] → simplify → verify → review → finish }',
    'Slice: \x1b[1m2026-05-14-migration-slice-02-runtime.md\x1b[22m | Plan: \x1b[1m2026-05-14-migration-index.md\x1b[22m',
    `Current task: Migrate runtime | Next task: Remove stale config | Slice 2/2 | Task 1/2 | ${expectedTotalTasksProgress(2, 3)}`,
  ]);
  assert.equal(
    renderWorkflowWidget(state, cwd)().render(120)[1].trimEnd(),
    'Slice: \x1b[1m2026-05-14-migration-slice-02-runtime.md\x1b[22m | Plan: \x1b[1m2026-05-14-migration-index.md\x1b[22m',
  );
});

test('workflow widget resolves numeric-prefix index plans to the first unfinished slice', () => {
  const cwd = join(taskFooterDir, 'numeric-prefix-index-plan-project');
  const plansDir = join(
    cwd,
    'docs',
    'plans',
    '2026-05-19-v3-invoice-converter-non-regression-suite',
  );
  mkdirSync(plansDir, { recursive: true });
  writeFileSync(
    join(plansDir, '00-index.md'),
    [
      '# V3 invoice converter non-regression suite plan index',
      '',
      '## Slice order',
      '',
      '1. [01 — Foundation contracts](./01-foundation-contracts.md)',
      '2. [02 — B2Bd first vertical proof](./02-b2bd-first-vertical-proof.md)',
    ].join('\n'),
  );
  writeFileSync(
    join(plansDir, '01-foundation-contracts.md'),
    [
      '## Task 1: Read active plan',
      '- [x] Implemented',
      '- [x] Verified',
      '- [x] Reviewed',
      '',
      '## Task 2: Implement runner skeleton',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );
  writeFileSync(
    join(plansDir, '02-b2bd-first-vertical-proof.md'),
    [
      '## Task 1: Build B2Bd proof',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  assert.deepEqual(
    renderWorkflowWidget(
      {
        ...createInitialWorkflowState(),
        current: 'build',
        phases: {
          ...createInitialWorkflowState().phases,
          define: 'complete',
          plan: 'complete',
          build: 'active',
        },
        activePlan:
          '@docs/plans/2026-05-19-v3-invoice-converter-non-regression-suite/00-index.md',
        committedTasks: committedTasksFor(
          '@docs/plans/2026-05-19-v3-invoice-converter-non-regression-suite/01-foundation-contracts.md',
          [{ taskIndex: 1, taskTitle: 'Read active plan', sliceIndex: 1 }],
        ),
      },
      cwd,
    )().render(),
    [
      'Addy Workflow: ✓define → ✓plan => { [build] → simplify → verify → review → finish }',
      'Plan: \x1b[1m00-index.md\x1b[22m',
      `Current task: Implement runner skeleton | Next task: none | Slice 1/2 | Task 2/2 | ${expectedTotalTasksProgress(2, 3)}`,
    ],
  );
});

test('workflow widget renders cumulative total task progress across slices', () => {
  const cwd = join(taskFooterDir, 'total-task-progress-project');
  const plansDir = join(cwd, 'docs', 'plans');
  mkdirSync(plansDir, { recursive: true });
  for (const sliceNumber of [1, 2, 3]) {
    writeFileSync(
      join(
        plansDir,
        `2026-05-21-feature-slice-${String(sliceNumber).padStart(2, '0')}.md`,
      ),
      [1, 2, 3, 4]
        .flatMap((taskNumber) => [
          `## Task ${taskNumber}: Slice ${sliceNumber} task ${taskNumber}`,
          taskNumber < 2 || sliceNumber < 2
            ? '- [x] Implemented'
            : '- [ ] Implemented',
          taskNumber < 2 || sliceNumber < 2
            ? '- [x] Verified'
            : '- [ ] Verified',
          taskNumber < 2 || sliceNumber < 2
            ? '- [x] Reviewed'
            : '- [ ] Reviewed',
          '',
        ])
        .join('\n'),
    );
  }

  const state = refreshWorkflowTasksFromPlan(
    {
      ...createInitialWorkflowState(),
      current: 'build',
      phases: {
        ...createInitialWorkflowState().phases,
        define: 'complete',
        plan: 'complete',
        build: 'active',
      },
      activePlan: '@docs/plans/2026-05-21-feature-slice-02.md',
      committedTasks: committedTasksFor(
        '@docs/plans/2026-05-21-feature-slice-02.md',
        [{ taskIndex: 1, taskTitle: 'Slice 2 task 1', sliceIndex: 2 }],
      ),
    },
    cwd,
  );

  assert.deepEqual(renderWorkflowWidget(state, cwd)().render(), [
    'Addy Workflow: ✓define → ✓plan => { [build] → simplify → verify → review → finish }',
    'Plan: \x1b[1m2026-05-21-feature-slice-02.md\x1b[22m',
    `Current task: Slice 2 task 2 | Next task: Slice 2 task 3 | Slice 2/3 | Task 2/4 | ${expectedTotalTasksProgress(6, 12)}`,
  ]);
});

test('workflow widget resolves Pi @-referenced active plan paths', () => {
  const cwd = join(taskFooterDir, 'at-reference-project');
  const planPath = join(cwd, 'docs', 'plans', 'task-footer.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    planPath,
    [
      '## Task 1: Parse invoice rows',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const state = refreshWorkflowTasksFromPlan(
    {
      ...createInitialWorkflowState(),
      current: 'build',
      phases: {
        ...createInitialWorkflowState().phases,
        define: 'complete',
        plan: 'complete',
        build: 'active',
      },
      activePlan: '@docs/plans/task-footer.md',
    },
    cwd,
  );

  assert.equal(state.currentTask, 'Parse invoice rows');
  assert.deepEqual(
    renderWorkflowWidget(
      { ...state, currentTask: undefined, nextTask: undefined },
      cwd,
    )().render(),
    [
      'Addy Workflow: ✓define → ✓plan => { [build] → simplify → verify → review → finish }',
      'Plan: \x1b[1mtask-footer.md\x1b[22m',
      'Current task: Parse invoice rows | Next task: none | Task 1/1',
    ],
  );
});

test('workflow widget renders task and slice progress for complete direct plan footer', () => {
  const cwd = join(taskFooterDir, 'complete-slice-project');
  const plansDir = join(cwd, 'docs', 'plans');
  mkdirSync(plansDir, { recursive: true });
  for (const sliceNumber of [1, 2, 3]) {
    writeFileSync(
      join(
        plansDir,
        `2026-05-08-invoice-csv-etl-slice-${String(sliceNumber).padStart(2, '0')}-test.md`,
      ),
      [
        '## Task 1: Complete task',
        '- [x] Implemented',
        '- [x] Verified',
        '- [x] Reviewed',
      ].join('\n'),
    );
  }

  const state = {
    ...createInitialWorkflowState(),
    current: 'build' as const,
    phases: {
      ...createInitialWorkflowState().phases,
      define: 'complete' as const,
      plan: 'complete' as const,
      build: 'active' as const,
    },
    activePlan: '@docs/plans/2026-05-08-invoice-csv-etl-slice-02-test.md',
    committedTasks: committedTasksFor(
      '@docs/plans/2026-05-08-invoice-csv-etl-slice-02-test.md',
      [{ taskIndex: 1, taskTitle: 'Complete task', sliceIndex: 2 }],
    ),
  };

  assert.deepEqual(renderWorkflowWidget(state, cwd)().render(), [
    'Addy Workflow: ✓define → ✓plan => { [build] → simplify → verify → review → finish }',
    'Plan: \x1b[1m2026-05-08-invoice-csv-etl-slice-02-test.md\x1b[22m',
    `Current task: all tasks complete | Next task: none | Slice 2/3 | Task 1/1 | ${expectedTotalTasksProgress(2, 3)}`,
  ]);
});

test('workflow widget does not treat date-prefixed plan names as slice progress', () => {
  const cwd = join(taskFooterDir, 'date-prefixed-plan-project');
  const plansDir = join(cwd, 'docs', 'plans');
  mkdirSync(plansDir, { recursive: true });
  writeFileSync(
    join(plansDir, '2026-05-12-addy-auto-command.md'),
    [
      '## Task 1: Add packaged auto prompt',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
      '',
      '## Task 2: Store/render auto mode',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
      '',
      '## Task 3: Wire auto command',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
      '',
      '## Task 4: Finish auto prompt',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const state = {
    ...createInitialWorkflowState(),
    current: 'build' as const,
    phases: {
      ...createInitialWorkflowState().phases,
      define: 'complete' as const,
      plan: 'complete' as const,
      build: 'active' as const,
    },
    activePlan: '@docs/plans/2026-05-12-addy-auto-command.md',
  };

  assert.deepEqual(renderWorkflowWidget(state, cwd)().render(), [
    'Addy Workflow: ✓define → ✓plan => { [build] → simplify → verify → review → finish }',
    'Plan: \x1b[1m2026-05-12-addy-auto-command.md\x1b[22m',
    'Current task: Add packaged auto prompt | Next task: Store/render auto mode | Task 1/4',
  ]);
});

test('workflow widget uses persisted task state when plan file is unavailable', () => {
  const state = {
    ...createInitialWorkflowState(),
    current: 'build' as const,
    phases: {
      ...createInitialWorkflowState().phases,
      define: 'complete' as const,
      plan: 'complete' as const,
      build: 'active' as const,
    },
    activePlan: 'docs/plans/missing.md',
    currentTask: 'Parse invoice rows',
    nextTask: 'Persist invoice payloads',
  };

  assert.deepEqual(renderWorkflowWidget(state)().render(), [
    'Addy Workflow: ✓define → ✓plan => { [build] → simplify → verify → review → finish }',
    'Plan: \x1b[1mmissing.md\x1b[22m',
    'Current task: Parse invoice rows | Next task: Persist invoice payloads',
  ]);
});

test('workflow widget prefers summarized task labels', () => {
  const state = {
    ...createInitialWorkflowState(),
    current: 'build' as const,
    phases: {
      ...createInitialWorkflowState().phases,
      define: 'complete' as const,
      plan: 'complete' as const,
      build: 'active' as const,
    },
    activePlan: 'docs/plans/task-footer.md',
    currentTask:
      'Runtime wires per-invoice state transitions parsed converted submitted',
    nextTask: 'Submit endpoint chooses draft live based on CSV isDraft',
    currentTaskIndex: 6,
    taskCount: 18,
    currentTaskSummary: 'Wire state transitions',
    nextTaskSummary: 'Route draft/live submits',
  };

  assert.deepEqual(renderWorkflowWidget(state)().render(), [
    'Addy Workflow: ✓define → ✓plan => { [build] → simplify → verify → review → finish }',
    'Plan: \x1b[1mtask-footer.md\x1b[22m',
    'Current task: Wire state transitions | Next task: Route draft/live submits | Task 6/18',
  ]);
});

test('workflow widget colors footer artifact name light blue', () => {
  const state = transitionWorkflow(createInitialWorkflowState(), {
    source: 'user-input',
    text: '/addy-plan docs/specs/2026-05-11-better-workflow.md',
  });
  const theme = {
    fg: (name: string, text: string) =>
      name === 'mdLinkUrl' ? `<light-blue>${text}</light-blue>` : text,
  };

  assert.deepEqual(renderWorkflowWidget(state)(undefined, theme).render(), [
    `Addy Workflow: define → [plan] => { build → simplify → verify → review → finish }`,
    `Spec: \x1b[1m<light-blue>2026-05-11-better-workflow.md</light-blue>\x1b[22m`,
  ]);
});

test('workflow widget colors task labels like workflow label', () => {
  const state = {
    ...createInitialWorkflowState(),
    current: 'build' as const,
    phases: {
      ...createInitialWorkflowState().phases,
      define: 'complete' as const,
      plan: 'complete' as const,
      build: 'active' as const,
    },
    activePlan: 'docs/plans/task-footer.md',
    currentTask: 'Parse invoice rows',
    nextTask: 'Persist invoice payloads',
    currentTaskIndex: 2,
    taskCount: 3,
  };
  const theme = {
    fg: (name: string, text: string) =>
      name === 'accent' ? `<accent>${text}</accent>` : text,
  };

  assert.deepEqual(renderWorkflowWidget(state)(undefined, theme).render(), [
    '<accent>Addy Workflow: </accent>✓define → ✓plan => { [build] → simplify → verify → review → finish }',
    '<accent>Plan: </accent>\x1b[1mtask-footer.md\x1b[22m',
    '<accent>Current task: </accent>Parse invoice rows | <accent>Next task: </accent>Persist invoice payloads | <accent>Task </accent>2/3',
  ]);
});

test('workflow widget dims simplify but not finish', () => {
  const state = transitionWorkflow(createInitialWorkflowState(), {
    source: 'user-input',
    text: '/addy-build',
  });
  const theme = {
    fg: (name: string, text: string) =>
      name === 'dim' ? `<dim>${text}</dim>` : text,
  };

  assert.deepEqual(renderWorkflowWidget(state)(undefined, theme).render(), [
    'Addy Workflow: ✓define → ✓plan => { [build] → <dim>simplify</dim> → verify → review → finish }',
  ]);
});

test('workflow widget truncates to render width', () => {
  const state = transitionWorkflow(createInitialWorkflowState(), {
    source: 'user-input',
    text: '/addy-workflow-next review docs/plans/2026-05-08-invoice-csv-etl-slice-05-ingestion-happy-path.md',
  });

  const [line] = renderWorkflowWidget(state)().render(80);
  assert.equal(visibleWidth(line) <= 80, true);
});

test('auto mode toggles without changing lifecycle phase', () => {
  const build = transitionWorkflow(createInitialWorkflowState(), {
    source: 'user-input',
    text: '/addy-build docs/plans/slice-01.md',
  });
  const auto = transitionWorkflow(
    { ...build, warnings: ['keep warning'] },
    { source: 'user-input', text: '/addy-auto docs/plans/slice-02.md' },
  );

  assert.equal(auto.current, 'build');
  assert.equal(auto.activePlan, 'docs/plans/slice-02.md');
  assert.equal(auto.autoMode, true);
  assert.deepEqual(auto.warnings, ['keep warning']);
  assert.deepEqual(renderWorkflowWidget(auto)().render(), [
    '🔁 Addy Workflow: ✓define → ✓plan => { [build] → simplify → verify → review → finish }',
    'Plan: \x1b[1mslice-02.md\x1b[22m',
  ]);

  const stopped = transitionWorkflow(auto, {
    source: 'user-input',
    text: '/addy-auto stop',
  });
  assert.equal(stopped.current, 'build');
  assert.equal(stopped.activePlan, 'docs/plans/slice-02.md');
  assert.equal(stopped.autoMode, false);
  assert.deepEqual(stopped.warnings, ['keep warning']);
  assert.deepEqual(renderWorkflowWidget(stopped)().render(), [
    'Addy Workflow: ✓define → ✓plan => { [build] → simplify → verify → review → finish }',
    'Plan: \x1b[1mslice-02.md\x1b[22m',
  ]);

  const unrelated = transitionWorkflow(build, {
    source: 'user-input',
    text: '/addy-autofoo docs/plans/slice-03.md',
  });
  assert.equal(unrelated.autoMode, undefined);
  assert.equal(unrelated.activePlan, 'docs/plans/slice-01.md');
});

test('parsed legacy after-plan state checks spec and plan before rendering', () => {
  const legacyBuild = {
    ...createInitialWorkflowState(),
    current: 'build' as const,
    phases: {
      ...createInitialWorkflowState().phases,
      build: 'active' as const,
    },
  };

  const state = parseWorkflowState(legacyBuild);

  assert.equal(state.phases.define, 'complete');
  assert.equal(state.phases.plan, 'complete');
  assert.deepEqual(renderWorkflowWidget(state)().render(), [
    'Addy Workflow: ✓define → ✓plan => { [build] → simplify → verify → review → finish }',
  ]);
});

test('completed active slice stays on current slice until finish', () => {
  const cwd = join(taskFooterDir, 'next-slice-project');
  const plansDir = join(cwd, 'docs', 'plans');
  mkdirSync(plansDir, { recursive: true });
  for (const sliceNumber of [1, 2, 3, 4, 7, 8]) {
    writeFileSync(
      join(
        plansDir,
        `2026-05-08-invoice-csv-etl-slice-${String(sliceNumber).padStart(2, '0')}-placeholder.md`,
      ),
      [
        '## Task 1: Placeholder complete task',
        '- [x] Implemented',
        '- [x] Verified',
        '- [x] Reviewed',
      ].join('\n'),
    );
  }
  writeFileSync(
    join(
      plansDir,
      '2026-05-08-invoice-csv-etl-slice-05-ingestion-happy-path.md',
    ),
    [
      '## Task 1: Finished slice task',
      '- [x] Implemented',
      '- [x] Verified',
      '- [x] Reviewed',
    ].join('\n'),
  );
  writeFileSync(
    join(
      plansDir,
      '2026-05-08-invoice-csv-etl-slice-06-failures-reports-reruns.md',
    ),
    [
      '## Task 1: Finished next task',
      '- [x] Implemented',
      '- [x] Verified',
      '- [x] Reviewed',
      '',
      '## Task 2: TRESO2 4xx body read fully',
      '- [x] Implemented',
      '- [x] Verified',
      '- [ ] Reviewed',
      '',
      '## Task 3: Report row has summarized error fields',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const state = refreshWorkflowTasksFromPlan(
    {
      ...createInitialWorkflowState(),
      current: 'verify',
      phases: {
        ...createInitialWorkflowState().phases,
        define: 'complete',
        plan: 'complete',
        build: 'complete',
        verify: 'active',
      },
      activePlan:
        '@docs/plans/2026-05-08-invoice-csv-etl-slice-05-ingestion-happy-path.md',
      committedTasks: committedTasksFor(
        '@docs/plans/2026-05-08-invoice-csv-etl-slice-05-ingestion-happy-path.md',
        [{ taskIndex: 1, taskTitle: 'Finished slice task', sliceIndex: 5 }],
      ),
    },
    cwd,
  );

  assert.equal(
    state.activePlan,
    '@docs/plans/2026-05-08-invoice-csv-etl-slice-05-ingestion-happy-path.md',
  );
  assert.equal(state.currentTask, 'all tasks complete');
  assert.equal(state.nextTask, 'none');
  assert.deepEqual(renderWorkflowWidget(state, cwd)().render(), [
    'Addy Workflow: ✓define → ✓plan => { ✓build → simplify → [verify] → review → finish }',
    'Plan: \x1b[1m2026-05-08-invoice-csv-etl-slice-05-ingestion-happy-path.md\x1b[22m',
    `Current task: all tasks complete | Next task: none | Slice 5/8 | Task 1/1 | ${expectedTotalTasksProgress(5, 10)}`,
  ]);
});

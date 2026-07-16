import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createInitialWorkflowState,
  resolveTargetPhase,
  transitionWorkflow,
  type WorkflowPhase,
} from '../extensions/workflow-monitor/workflow-transitions.ts';
import {
  nextPromptForActivePlanLifecycle,
  nextUnfinishedSlicePlanPath,
  nextWorkflowActionForActivePlanLifecycle,
  nextPromptForPhase,
  planTasksFromMarkdown,
  readSlicePlanProgress,
  refreshWorkflowTasksFromPlan,
  unfinishedLifecycleStepsFromMarkdown,
  workflowTaskCommitKey,
} from '../extensions/workflow-monitor/workflow-tracker.ts';
import { parseWorkflowState } from '../extensions/workflow-monitor/workflow-state-codec.ts';
import {
  handleWorkflowEvent,
  openNextWorkflowPrompt,
  resetWorkflow,
} from '../extensions/workflow-monitor/workflow-handler.ts';
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

test('prompt triggers map to phases', () => {
  assert.equal(
    resolveTargetPhase({ source: 'user-input', text: '/addy-define' }),
    'define',
  );
  assert.equal(
    resolveTargetPhase({ source: 'user-input', text: '/addy-plan' }),
    'plan',
  );
  assert.equal(
    resolveTargetPhase({ source: 'user-input', text: '/addy-build' }),
    'build',
  );
  assert.equal(
    resolveTargetPhase({ source: 'user-input', text: '/addy-code-simplify' }),
    'simplify',
  );
  assert.equal(
    resolveTargetPhase({ source: 'user-input', text: '/addy-verify' }),
    'verify',
  );
  assert.equal(
    resolveTargetPhase({ source: 'user-input', text: '/addy-review' }),
    'review',
  );
  assert.equal(
    resolveTargetPhase({ source: 'user-input', text: '/addy-finish' }),
    'finish',
  );
  assert.equal(
    resolveTargetPhase({
      source: 'user-input',
      text: 'commit all changes just like /addy-finish would do',
    }),
    undefined,
  );
});

test('ticket queue labels are not extracted as active plans', () => {
  const auto = transitionWorkflow(createInitialWorkflowState(), {
    source: 'command',
    text: '/addy-auto --tickets --label docs/plans/backend.md',
    artifact: 'docs/plans/backend.md',
  });

  assert.equal(auto.activePlan, undefined);
});

test('manual Addy command exits auto mode', () => {
  const auto = transitionWorkflow(createInitialWorkflowState(), {
    source: 'user-input',
    text: '/addy-auto docs/plans/slice-01.md',
  });
  const build = transitionWorkflow(auto, {
    source: 'user-input',
    text: '/addy-build docs/plans/slice-01.md',
    manualAddyCommand: true,
  });

  assert.equal(build.current, 'build');
  assert.equal(build.activePlan, 'docs/plans/slice-01.md');
  assert.equal(build.autoMode, false);
  assert.equal(build.autoLastPrompt, undefined);
  assert.equal(build.autoRetryKey, undefined);
});

test('forward transition shows spec and plan checked once building', () => {
  const define = transitionWorkflow(createInitialWorkflowState(), {
    source: 'user-input',
    text: '/addy-define',
  });
  const build = transitionWorkflow(define, {
    source: 'user-input',
    text: '/addy-build',
  });

  assert.equal(build.phases.define, 'complete');
  assert.equal(build.phases.plan, 'complete');
  assert.equal(build.phases.build, 'active');
  assert.deepEqual(build.warnings, []);
});

test('fresh build and simplify are allowed but verify and review enforce build to verify to review', () => {
  const build = transitionWorkflow(createInitialWorkflowState(), {
    source: 'user-input',
    text: '/addy-build',
  });
  assert.equal(build.current, 'build');
  assert.equal(build.phases.define, 'complete');
  assert.equal(build.phases.plan, 'complete');
  assert.deepEqual(build.warnings, []);

  const simplify = transitionWorkflow(createInitialWorkflowState(), {
    source: 'user-input',
    text: '/addy-code-simplify',
  });
  assert.equal(simplify.current, 'simplify');
  assert.equal(simplify.phases.define, 'complete');
  assert.equal(simplify.phases.plan, 'complete');
  assert.deepEqual(simplify.warnings, []);

  const verify = transitionWorkflow(createInitialWorkflowState(), {
    source: 'user-input',
    text: '/addy-verify',
  });
  assert.equal(verify.current, 'verify');
  assert.match(verify.warnings[0], /build/);

  const review = transitionWorkflow(createInitialWorkflowState(), {
    source: 'user-input',
    text: '/addy-review',
  });
  assert.equal(review.current, 'review');
  assert.match(review.warnings[0], /build/);
});

test('same-phase after-plan transition checks spec and plan for legacy state', () => {
  const legacyBuild = {
    ...createInitialWorkflowState(),
    current: 'build' as const,
    phases: {
      ...createInitialWorkflowState().phases,
      build: 'active' as const,
    },
  };

  const build = transitionWorkflow(legacyBuild, {
    source: 'user-input',
    text: '/addy-build',
  });

  assert.equal(build.current, 'build');
  assert.equal(build.phases.define, 'complete');
  assert.equal(build.phases.plan, 'complete');
  assert.equal(build.phases.build, 'active');
});

test('returning to optional simplify preserves completed build', () => {
  const build = transitionWorkflow(createInitialWorkflowState(), {
    source: 'user-input',
    text: '/addy-build',
  });
  const verify = transitionWorkflow(build, {
    source: 'user-input',
    text: '/addy-verify',
  });
  const simplify = transitionWorkflow(verify, {
    source: 'user-input',
    text: '/addy-code-simplify',
  });
  const verifyAgain = transitionWorkflow(simplify, {
    source: 'user-input',
    text: '/addy-verify',
  });

  assert.equal(simplify.current, 'simplify');
  assert.equal(simplify.phases.build, 'complete');
  assert.equal(simplify.phases.verify, 'pending');
  assert.deepEqual(verifyAgain.warnings, []);
});

test('finish warns when required build verify review phases are skipped', () => {
  const finish = transitionWorkflow(createInitialWorkflowState(), {
    source: 'user-input',
    text: '/addy-finish',
  });
  assert.equal(finish.current, 'finish');
  assert.equal(finish.phases.define, 'complete');
  assert.equal(finish.phases.plan, 'complete');
  assert.match(finish.warnings[0], /build/);
});

test('finish warns about both verify and review when started after build', () => {
  const build = transitionWorkflow(createInitialWorkflowState(), {
    source: 'user-input',
    text: '/addy-build',
  });
  const finish = transitionWorkflow(build, {
    source: 'user-input',
    text: '/addy-finish',
  });

  assert.equal(finish.current, 'finish');
  assert.equal(finish.phases.build, 'complete');
  assert.equal(finish.phases.finish, 'active');
  assert.match(finish.warnings[0], /verify and review/);
});

test('finish skip warning does not delay active phase state', () => {
  const build = transitionWorkflow(createInitialWorkflowState(), {
    source: 'user-input',
    text: '/addy-build',
  });
  const finish = transitionWorkflow(build, {
    source: 'user-input',
    text: '/addy-finish',
  });

  assert.equal(finish.current, 'finish');
  assert.equal(finish.phases.build, 'complete');
  assert.equal(finish.phases.finish, 'active');
  assert.match(finish.warnings[0], /verify and review/);
});

test('review warns when verify is skipped after build', () => {
  const build = transitionWorkflow(createInitialWorkflowState(), {
    source: 'user-input',
    text: '/addy-build',
  });
  const review = transitionWorkflow(build, {
    source: 'user-input',
    text: '/addy-review',
  });

  assert.equal(review.current, 'review');
  assert.equal(review.phases.build, 'complete');
  assert.equal(review.phases.review, 'active');
  assert.match(review.warnings[0], /verify/);
});

test('review skip warning does not delay active phase state', () => {
  const build = transitionWorkflow(createInitialWorkflowState(), {
    source: 'user-input',
    text: '/addy-build',
  });
  const review = transitionWorkflow(build, {
    source: 'user-input',
    text: '/addy-review',
  });

  assert.equal(review.current, 'review');
  assert.equal(review.phases.build, 'complete');
  assert.equal(review.phases.review, 'active');
  assert.match(review.warnings[0], /verify/);
});

test('backward transition resets state', () => {
  const finish = transitionWorkflow(createInitialWorkflowState(), {
    source: 'user-input',
    text: '/addy-finish',
  });
  const plan = transitionWorkflow(finish, {
    source: 'user-input',
    text: '/addy-plan',
  });

  assert.equal(plan.current, 'plan');
  assert.equal(plan.phases.define, 'complete');
  assert.equal(plan.phases.finish, 'pending');
});

test('file write triggers map to lifecycle phases', () => {
  const cases: Array<[string, WorkflowPhase | undefined]> = [
    ['SPEC.md', 'define'],
    ['spec.md', 'define'],
    ['docs/specs/feature.md', 'define'],
    ['docs/prd/feature.md', 'define'],
    ['docs/plans/feature.md', 'plan'],
    ['src/index.ts', 'build'],
    ['src/index.test.ts', 'verify'],
    ['tests/index.ts', 'verify'],
    ['CHANGELOG.md', 'finish'],
    ['RELEASE.md', 'finish'],
    ['docs/releases/v1.md', 'finish'],
    ['docs/deploy/prod.md', 'finish'],
  ];

  for (const [artifact, phase] of cases) {
    assert.equal(
      resolveTargetPhase({ source: 'file-write', artifact }),
      phase,
      artifact,
    );
  }
});

test('source, test, and plan file writes are ignored after their lifecycle phases', () => {
  assert.equal(
    resolveTargetPhase(
      { source: 'file-write', artifact: 'src/index.ts' },
      'verify',
    ),
    undefined,
  );
  assert.equal(
    resolveTargetPhase(
      { source: 'file-write', artifact: 'tests/index.test.ts' },
      'review',
    ),
    undefined,
  );
  assert.equal(
    resolveTargetPhase(
      { source: 'file-write', artifact: 'docs/plans/feature.md' },
      'review',
    ),
    undefined,
  );
});

test('tool and subagent triggers map to verify and review', () => {
  assert.equal(
    resolveTargetPhase({
      source: 'tool-result',
      command: 'npm test',
      success: true,
    }),
    'verify',
  );
  assert.equal(
    resolveTargetPhase({
      source: 'tool-result',
      command: 'pnpm vitest',
      success: true,
    }),
    'verify',
  );
  assert.equal(
    resolveTargetPhase({ source: 'subagent-call', agentName: 'addy-reviewer' }),
    'review',
  );
  assert.equal(
    resolveTargetPhase({
      source: 'subagent-call',
      agentName: 'addy-spec-reviewer',
    }),
    'review',
  );
});

test('next prompt includes artifact when provided', () => {
  assert.equal(
    nextPromptForPhase('finish', 'release-notes.md'),
    '/addy-finish release-notes.md',
  );
});

test('tracks active spec and plan artifacts', () => {
  const specPath = 'docs/specs/2026-05-11-better-workflow.md';
  const planPath = 'docs/plans/2026-05-11-better-workflow.md';

  const define = transitionWorkflow(createInitialWorkflowState(), {
    source: 'file-write',
    artifact: specPath,
  });
  assert.equal(define.activeSpec, specPath);

  const plan = transitionWorkflow(define, {
    source: 'user-input',
    text: `/addy-plan ${specPath}`,
  });
  assert.equal(plan.activeSpec, specPath);

  const planned = transitionWorkflow(plan, {
    source: 'file-write',
    artifact: planPath,
  });
  assert.equal(planned.activePlan, planPath);

  const build = transitionWorkflow(planned, {
    source: 'user-input',
    text: '/addy-build',
  });
  assert.equal(build.activeSpec, specPath);
  assert.equal(build.activePlan, planPath);

  const override = transitionWorkflow(build, {
    source: 'user-input',
    text: '/addy-review docs/plans/override-plan.md',
  });
  assert.equal(override.activePlan, 'docs/plans/override-plan.md');
});

test('active plan writes after planning do not regress the workflow phase', () => {
  const planPath = 'docs/plans/feature.md';
  const review = transitionWorkflow(
    { ...createInitialWorkflowState(), activePlan: planPath },
    { source: 'user-input', text: `/addy-review ${planPath}` },
  );

  const updated = transitionWorkflow(review, {
    source: 'file-write',
    artifact: planPath,
  });

  assert.equal(updated.current, 'review');
  assert.equal(updated.activePlan, planPath);
  assert.equal(updated.phases.review, 'active');
  assert.equal(updated.phases.plan, 'complete');
});

test('define prompt distinguishes spec arguments from build explanations', () => {
  const specPath = 'docs/specs/2026-05-12-204500-autonomous-slice-plan.md';

  const fromPath = transitionWorkflow(createInitialWorkflowState(), {
    source: 'user-input',
    text: `/addy-define ${specPath}`,
  });
  assert.equal(fromPath.current, 'define');
  assert.equal(fromPath.activeSpec, specPath);

  const explanation = transitionWorkflow(createInitialWorkflowState(), {
    source: 'user-input',
    text: '/addy-define "The main goal here is to automate grinding through a slice plan."',
  });
  assert.equal(explanation.current, 'define');
  assert.equal(explanation.activeSpec, undefined);

  const explanationWithPathWords = transitionWorkflow(
    createInitialWorkflowState(),
    {
      source: 'user-input',
      text: '/addy-define "I want to build a docs/specs/ tool"',
    },
  );
  assert.equal(explanationWithPathWords.current, 'define');
  assert.equal(explanationWithPathWords.activeSpec, undefined);
});

test('only command-leading user text starts workflow commands', () => {
  const state = transitionWorkflow(createInitialWorkflowState(), {
    source: 'user-input',
    text: 'please run /addy-plan for the current spec',
  });

  assert.equal(state.current, undefined);
  assert.equal(state.activeSpec, undefined);
});

test('absolute spec and plan file writes update active artifacts', () => {
  const specPath =
    '/Users/eric/Dev/pi-addy-workflow/docs/specs/2026-05-11-better-workflow.md';
  const planPath =
    '/Users/eric/Dev/pi-addy-workflow/docs/plans/2026-05-11-better-workflow.md';

  const define = transitionWorkflow(createInitialWorkflowState(), {
    source: 'file-write',
    artifact: specPath,
  });
  assert.equal(define.activeSpec, specPath);

  const plan = transitionWorkflow(define, {
    source: 'file-write',
    artifact: planPath,
  });
  assert.equal(plan.activeSpec, specPath);
  assert.equal(plan.activePlan, planPath);
});

test('completed slice stays on current plan so finish runs before next slice', () => {
  const cwd = join(taskFooterDir, 'completed-slice-project');
  const plansDir = join(cwd, 'docs', 'plans');
  mkdirSync(plansDir, { recursive: true });
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
    ].join('\n'),
  );

  const activePlan = '@docs/plans/2026-05-14-migration-slice-01-api.md';
  const state = refreshWorkflowTasksFromPlan(
    {
      ...createInitialWorkflowState(),
      current: 'review',
      phases: {
        ...createInitialWorkflowState().phases,
        define: 'complete',
        plan: 'complete',
        build: 'complete',
        verify: 'complete',
        review: 'active',
      },
      activePlan,
      committedTasks: committedTasksFor(activePlan, [
        { taskIndex: 1, taskTitle: 'Complete public API', sliceIndex: 1 },
      ]),
    },
    cwd,
  );

  assert.equal(state.activePlan, activePlan);
  assert.equal(state.currentTask, 'all tasks complete');
  assert.equal(
    nextPromptForActivePlanLifecycle(state, cwd),
    `/addy-finish ${activePlan}`,
  );
});

test('refreshing workflow tasks clears stale summaries when task changes', () => {
  const planPath = join(taskFooterDir, 'stale-summary.md');
  writeFileSync(
    planPath,
    [
      '## Task 1: New task name',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const state = refreshWorkflowTasksFromPlan({
    ...createInitialWorkflowState(),
    current: 'build',
    activePlan: planPath,
    currentTask: 'Old task name',
    currentTaskSummary: 'Old summary',
  });

  assert.equal(state.currentTask, 'New task name');
  assert.equal(state.currentTaskSummary, undefined);
});

test('slice plan progress snapshot returns frontier action and footer progress', () => {
  const planPath = join(taskFooterDir, 'slice-plan-progress.md');
  writeFileSync(
    planPath,
    [
      '## Task 1: Closed task',
      '- [x] Implemented',
      '- [x] Verified',
      '- [x] Reviewed',
      '',
      '## Task 2: Verify task',
      '- [x] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const progress = readSlicePlanProgress({
    ...createInitialWorkflowState(),
    activePlan: planPath,
    committedTasks: committedTasksFor(planPath, [
      { taskIndex: 1, taskTitle: 'Closed task' },
    ]),
  });

  assert.equal(progress?.activePlan, planPath);
  assert.equal(progress?.currentTask, 'Verify task');
  assert.equal(progress?.nextTask, 'none');
  assert.equal(progress?.currentTaskIndex, 2);
  assert.equal(progress?.taskCount, 2);
  assert.deepEqual(progress?.action, {
    prompt: `/addy-verify ${planPath}`,
    plan: planPath,
    taskTitle: 'Verify task',
    taskIndex: 2,
    missingStatuses: ['Verified', 'Reviewed'],
  });
});

test('refreshing workflow tasks does not reopen fully checked task from stale review target', () => {
  const planPath = join(taskFooterDir, 'stale-review-target.md');
  writeFileSync(
    planPath,
    [
      '## Task 1: Already reviewed task',
      '- [x] Implemented',
      '- [x] Verified',
      '- [x] Reviewed',
      '',
      '## Task 2: Next unfinished task',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const state = refreshWorkflowTasksFromPlan({
    ...createInitialWorkflowState(),
    current: 'review',
    activePlan: planPath,
    currentTask: 'Already reviewed task',
    nextTask: 'Next unfinished task',
    currentTaskIndex: 1,
    taskCount: 2,
    currentTaskSummary: 'Reviewed summary',
    nextTaskSummary: 'Next summary',
    autoReviewTask: 'Already reviewed task',
    autoReviewTaskIndex: 1,
    committedTasks: committedTasksFor(planPath, [
      { taskIndex: 1, taskTitle: 'Already reviewed task' },
    ]),
  });

  assert.equal(state.currentTask, 'Next unfinished task');
  assert.equal(state.nextTask, 'none');
  assert.equal(state.currentTaskIndex, 2);
  assert.equal(state.taskCount, 2);
  assert.equal(state.currentTaskSummary, undefined);
  assert.equal(state.nextTaskSummary, undefined);
});

test('refreshing workflow keeps completed direct slice on finish boundary', () => {
  const cwd = join(taskFooterDir, 'repair-stale-complete-plan-project');
  const plansDir = join(cwd, 'docs', 'plans');
  mkdirSync(plansDir, { recursive: true });
  writeFileSync(
    join(plansDir, '2026-05-08-invoice-csv-etl-slice-08-prod-readiness.md'),
    [
      '## Task 20: Complete task',
      '- [x] Implemented',
      '- [x] Verified',
      '- [x] Reviewed',
    ].join('\n'),
  );
  writeFileSync(
    join(
      plansDir,
      '2026-05-08-invoice-csv-etl-slice-09-admin-module-boundaries.md',
    ),
    [
      '## Task 1: Admin boundaries',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  const state = refreshWorkflowTasksFromPlan(
    {
      ...createInitialWorkflowState(),
      current: 'plan',
      phases: {
        ...createInitialWorkflowState().phases,
        define: 'complete',
        plan: 'active',
      },
      warnings: ['finish started before build and verify and review.'],
      activePlan:
        'docs/plans/2026-05-08-invoice-csv-etl-slice-08-prod-readiness.md',
      committedTasks: committedTasksFor(
        'docs/plans/2026-05-08-invoice-csv-etl-slice-08-prod-readiness.md',
        [{ taskIndex: 1, taskTitle: 'Complete task', sliceIndex: 8 }],
      ),
      currentTask: 'all tasks complete',
      nextTask: 'none',
      currentTaskIndex: 20,
      taskCount: 20,
      currentSliceIndex: 8,
      sliceCount: 9,
    },
    cwd,
  );

  assert.equal(state.current, 'plan');
  assert.equal(state.phases.plan, 'active');
  assert.equal(state.phases.build, 'pending');
  assert.deepEqual(state.warnings, [
    'finish started before build and verify and review.',
  ]);
  assert.equal(
    state.activePlan,
    'docs/plans/2026-05-08-invoice-csv-etl-slice-08-prod-readiness.md',
  );
  assert.equal(state.currentTask, 'all tasks complete');
  assert.equal(state.currentTaskIndex, 1);
  assert.equal(state.taskCount, 1);
  assert.equal(state.currentSliceIndex, 8);
  assert.equal(state.sliceCount, 9);
});

test('plan task parser supports checklist tasks', () => {
  assert.deepEqual(
    planTasksFromMarkdown('- [x] First task\n- [ ] Second task'),
    [
      { title: 'First task', complete: true },
      { title: 'Second task', complete: false },
    ],
  );
});

test('plan task parser keeps status tasks current until implemented verified and reviewed', () => {
  assert.deepEqual(
    planTasksFromMarkdown(
      [
        '## Task 1: Build finished but not verified',
        '- [x] Implemented',
        '- [ ] Verified',
        '- [ ] Reviewed',
        '',
        '## Task 2: Fully complete task',
        '- [x] Implemented',
        '- [x] Verified',
        '- [x] Reviewed',
      ].join('\n'),
    ),
    [
      {
        title: 'Build finished but not verified',
        complete: false,
        missingStatuses: ['Verified', 'Reviewed'],
      },
      { title: 'Fully complete task', complete: true, missingStatuses: [] },
    ],
  );
});

test('unfinished lifecycle step helper reports missing finish prerequisites', () => {
  assert.deepEqual(
    unfinishedLifecycleStepsFromMarkdown(
      [
        '## Task 0: Not started',
        '- [ ] Implemented',
        '- [ ] Verified',
        '- [ ] Reviewed',
        '',
        '## Task 1: Build finished but not verified',
        '- [x] Implemented',
        '- [ ] Verified',
        '- [ ] Reviewed',
        '',
        '## Task 2: Verified but not reviewed',
        '- [x] Implemented',
        '- [x] Verified',
        '- [ ] Reviewed',
      ].join('\n'),
    ),
    [
      {
        title: 'Build finished but not verified',
        missingStatuses: ['Verified', 'Reviewed'],
      },
      { title: 'Verified but not reviewed', missingStatuses: ['Reviewed'] },
    ],
  );
});

test('active plan lifecycle ignores verified and reviewed checkboxes without phase-run evidence for the current task', () => {
  const cwd = join(taskFooterDir, 'phase-evidence-project');
  const planPath = join('docs', 'plans', 'phase-evidence.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Build illegally checked everything',
      '- [x] Implemented',
      '- [x] Verified',
      '- [x] Reviewed',
      '',
      '## Task 2: Later task',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  assert.deepEqual(
    nextWorkflowActionForActivePlanLifecycle(
      {
        ...createInitialWorkflowState(),
        activePlan: planPath,
        currentTask: 'Build illegally checked everything',
        currentTaskIndex: 1,
        autoLastPrompt: `/addy-build ${planPath}`,
      },
      cwd,
    ),
    {
      prompt: `/addy-verify ${planPath}`,
      plan: planPath,
      taskTitle: 'Build illegally checked everything',
      taskIndex: 1,
      missingStatuses: ['Verified', 'Reviewed'],
    },
  );
});

test('active plan lifecycle ignores verified checkbox without phase-run evidence after resume', () => {
  const cwd = join(taskFooterDir, 'phase-evidence-resume-project');
  const planPath = join('docs', 'plans', 'phase-evidence-resume.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Resumed illegal checkbox state',
      '- [x] Implemented',
      '- [x] Verified',
      '- [ ] Reviewed',
      '',
      '## Task 2: Later task',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  assert.deepEqual(
    nextWorkflowActionForActivePlanLifecycle(
      {
        ...createInitialWorkflowState(),
        activePlan: planPath,
        currentTask: 'Resumed illegal checkbox state',
        currentTaskIndex: 1,
        stats: {
          active: {
            tasks: {
              [`${planPath}\u001f\u001f1\u001fResumed illegal checkbox state`]:
                {
                  plan: planPath,
                  taskIndex: 1,
                  taskTitle: 'Resumed illegal checkbox state',
                  turns: 1,
                  verifyRuns: 0,
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
      },
      cwd,
    ),
    {
      prompt: `/addy-verify ${planPath}`,
      plan: planPath,
      taskTitle: 'Resumed illegal checkbox state',
      taskIndex: 1,
      missingStatuses: ['Reviewed', 'Verified'],
    },
  );
});

test('active plan lifecycle sends reviewed task to commit before later build', () => {
  const cwd = join(taskFooterDir, 'phase-evidence-reviewed-project');
  const planPath = join('docs', 'plans', 'phase-evidence-reviewed.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Reviewed by Addy',
      '- [x] Implemented',
      '- [x] Verified',
      '- [x] Reviewed',
      '',
      '## Task 2: Later task',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  assert.deepEqual(
    nextWorkflowActionForActivePlanLifecycle(
      {
        ...createInitialWorkflowState(),
        activePlan: planPath,
        currentTask: 'Reviewed by Addy',
        currentTaskIndex: 1,
        autoLastPrompt: `/addy-review ${planPath}`,
        stats: {
          active: {
            tasks: {
              [`${planPath}\u001f\u001f1\u001fReviewed by Addy`]: {
                plan: planPath,
                taskIndex: 1,
                taskTitle: 'Reviewed by Addy',
                turns: 3,
                verifyRuns: 1,
                reviewRuns: 1,
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
      },
      cwd,
    ),
    {
      prompt: '__addy-auto-task-commit__',
      plan: planPath,
      taskTitle: 'Reviewed by Addy',
      taskIndex: 1,
      missingStatuses: [],
      requiresCommit: true,
    },
  );
});

test('active plan lifecycle routes verified task to review before later build', () => {
  const cwd = join(taskFooterDir, 'phase-evidence-verified-project');
  const planPath = join('docs', 'plans', 'phase-evidence-verified.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Verified by Addy',
      '- [x] Implemented',
      '- [x] Verified',
      '- [ ] Reviewed',
      '',
      '## Task 2: Later task',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  assert.deepEqual(
    nextWorkflowActionForActivePlanLifecycle(
      {
        ...createInitialWorkflowState(),
        activePlan: planPath,
        currentTask: 'Verified by Addy',
        currentTaskIndex: 1,
      },
      cwd,
    ),
    {
      prompt: `/addy-review ${planPath}`,
      plan: planPath,
      taskTitle: 'Verified by Addy',
      taskIndex: 1,
      missingStatuses: ['Reviewed'],
    },
  );
});

test('next slice discovery waits for commit ledger on checked final task', () => {
  const cwd = join(taskFooterDir, 'slice-boundary-commit-gate-project');
  const firstPlan = join('docs', 'plans', 'feature-slice-01.md');
  const secondPlan = join('docs', 'plans', 'feature-slice-02.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, firstPlan),
    [
      '## Task 1: Last task',
      '- [x] Implemented',
      '- [x] Verified',
      '- [x] Reviewed',
    ].join('\n'),
  );
  writeFileSync(
    join(cwd, secondPlan),
    [
      '## Task 1: Next slice task',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  assert.equal(
    nextUnfinishedSlicePlanPath(
      { ...createInitialWorkflowState(), activePlan: firstPlan },
      cwd,
    ),
    undefined,
  );
  assert.equal(
    nextUnfinishedSlicePlanPath(
      {
        ...createInitialWorkflowState(),
        activePlan: firstPlan,
        committedTasks: committedTasksFor(firstPlan, [
          { taskIndex: 1, taskTitle: 'Last task' },
        ]),
      },
      cwd,
    ),
    secondPlan,
  );
});

test('active plan lifecycle advances after reviewed task has commit ledger entry', () => {
  const cwd = join(taskFooterDir, 'phase-evidence-reviewed-committed-project');
  const planPath = join(
    'docs',
    'plans',
    'phase-evidence-reviewed-committed.md',
  );
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Reviewed by Addy',
      '- [x] Implemented',
      '- [x] Verified',
      '- [x] Reviewed',
      '',
      '## Task 2: Later task',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  assert.deepEqual(
    nextWorkflowActionForActivePlanLifecycle(
      {
        ...createInitialWorkflowState(),
        activePlan: planPath,
        committedTasks: committedTasksFor(planPath, [
          { taskIndex: 1, taskTitle: 'Reviewed by Addy' },
        ]),
      },
      cwd,
    ),
    {
      prompt: `/addy-build ${planPath}`,
      plan: planPath,
      taskTitle: 'Later task',
      taskIndex: 2,
      missingStatuses: ['Implemented', 'Verified', 'Reviewed'],
    },
  );
});

test('active plan lifecycle matches commit ledger by stable task id after title edit', () => {
  const cwd = join(taskFooterDir, 'phase-evidence-stable-task-id-project');
  const planPath = join('docs', 'plans', 'phase-evidence-stable-task-id.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: Renamed by reviewer',
      '<!-- addy-task-id: task-k7p4x9 -->',
      '- [x] Implemented',
      '- [x] Verified',
      '- [x] Reviewed',
      '',
      '## Task 2: Later task',
      '<!-- addy-task-id: task-n8q2z4 -->',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  assert.deepEqual(
    nextWorkflowActionForActivePlanLifecycle(
      {
        ...createInitialWorkflowState(),
        activePlan: planPath,
        committedTasks: {
          [workflowTaskCommitKey(planPath, 1, 'Original title', 'task-k7p4x9')]:
            {
              plan: planPath,
              taskId: 'task-k7p4x9',
              taskIndex: 1,
              taskTitle: 'Original title',
              commitSha: 'abc1234',
              committedAt: '2026-05-22T00:00:00.000Z',
            },
        },
      },
      cwd,
    ),
    {
      prompt: `/addy-build ${planPath}`,
      plan: planPath,
      taskTitle: 'Later task',
      taskId: 'task-n8q2z4',
      taskIndex: 2,
      missingStatuses: ['Implemented', 'Verified', 'Reviewed'],
    },
  );
});

test('plan task parser ignores nested checklist items when status task headings exist', () => {
  assert.deepEqual(
    planTasksFromMarkdown(
      [
        '## Task 1: Parse invoice rows',
        '- [ ] Implemented',
        '- [ ] Verified',
        '- [ ] Reviewed',
        '- [ ] Acceptance criterion that is not a task',
      ].join('\n'),
    ),
    [
      {
        title: 'Parse invoice rows',
        complete: false,
        missingStatuses: ['Implemented', 'Verified', 'Reviewed'],
      },
    ],
  );
});

test('workflow handler sets widget, reset clears widget, next opens prompt', () => {
  const widgets: Array<[string, unknown]> = [];
  const ctx: any = {
    id: 'workflow-handler-test',
    ui: {
      setWidget: (key: string, value: unknown) => widgets.push([key, value]),
    },
    input: { prefill: (value: string) => widgets.push(['prefill', value]) },
  };

  handleWorkflowEvent(ctx, {
    source: 'command',
    text: '/addy-workflow-next review',
    artifact: 'diff.md',
  });
  assert.equal(ctx.state.current, 'review');
  assert.equal(
    openNextWorkflowPrompt(ctx, 'review', 'diff.md'),
    '/addy-review diff.md',
  );
  resetWorkflow(ctx);

  assert.equal(widgets.at(0)?.[0], 'pi-addy-workflow');
  assert.deepEqual((widgets.at(0)?.[1] as any)().render(), [
    'Addy Workflow: ✓define → ✓plan => { build → simplify → verify → [review] → finish }',
    'Plan: \x1b[1mdiff.md\x1b[22m',
  ]);
  assert.deepEqual(widgets.at(1), ['prefill', '/addy-review diff.md']);
  assert.deepEqual(widgets.at(2), ['pi-addy-workflow', undefined]);
});

test('workflow next prompt falls back to active artifacts', () => {
  const specPath = 'docs/specs/2026-05-11-better-workflow.md';
  const planPath = 'docs/plans/2026-05-11-better-workflow.md';
  const widgets: Array<[string, unknown]> = [];
  const ctx: any = {
    state: {
      ...createInitialWorkflowState(),
      activeSpec: specPath,
      activePlan: planPath,
    },
    input: { prefill: (value: string) => widgets.push(['prefill', value]) },
  };

  assert.equal(openNextWorkflowPrompt(ctx, 'plan'), `/addy-plan ${specPath}`);
  assert.equal(openNextWorkflowPrompt(ctx, 'build'), `/addy-build ${planPath}`);
});

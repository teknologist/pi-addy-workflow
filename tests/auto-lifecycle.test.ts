import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  actionTargetsCompletePlanTask,
  autoPauseWarning,
  autoRecoveryPrompt,
  completedPlanAutoContinuation,
  latestCompletedActiveStatsTarget,
  nextWorkflowActionForExecutionSource,
  planTaskIsComplete,
  reviewedTaskWasCompleted,
  stateWithCompletedLifecyclePhasesFromPlan,
} from '../extensions/workflow-monitor/auto-lifecycle.ts';
import { workflowTaskCommitKey } from '../extensions/workflow-monitor/plan-task-lifecycle.ts';
import { createInitialWorkflowState } from '../extensions/workflow-monitor/workflow-transitions.ts';

function writePlan(markdown: string): { dir: string; plan: string } {
  const dir = mkdtempSync(join(tmpdir(), 'pi-addy-auto-lifecycle-'));
  const plan = join(dir, 'PLAN.md');
  writeFileSync(plan, markdown);
  return { dir, plan };
}

test('auto lifecycle detects completed plan tasks by stable task id', () => {
  const { dir, plan } = writePlan(`# Plan

## Task 1. Extract module
<!-- addy-task-id: task-123 -->
- [x] Implemented
- [x] Verified
- [x] Reviewed
`);
  try {
    assert.equal(
      planTaskIsComplete(plan, undefined, {
        taskId: 'task-123',
        taskTitle: 'Renamed task',
      }),
      true,
    );
    assert.equal(
      actionTargetsCompletePlanTask(
        { ...createInitialWorkflowState(), activePlan: plan },
        {
          prompt: '/addy-review PLAN.md',
          taskId: 'task-123',
          taskTitle: 'Extract module',
        },
      ),
      true,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('auto lifecycle returns latest completed active stats target', () => {
  const { dir, plan } = writePlan(`# Plan

## Task 1. First
- [x] Implemented
- [x] Verified
- [x] Reviewed

## Task 2. Second
- [ ] Implemented
- [ ] Verified
- [ ] Reviewed
`);
  try {
    const target = latestCompletedActiveStatsTarget({
      ...createInitialWorkflowState(),
      activePlan: plan,
      stats: {
        active: {
          tasks: {
            first: {
              plan,
              taskIndex: 1,
              taskTitle: 'First',
              turns: 1,
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
    });

    assert.equal(target?.taskTitle, 'First');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('auto lifecycle sees reviewed task movement as completion', () => {
  assert.equal(
    reviewedTaskWasCompleted(
      {
        ...createInitialWorkflowState(),
        activePlan: 'PLAN.md',
        currentTask: 'First',
        currentTaskIndex: 1,
        taskCount: 2,
      },
      {
        ...createInitialWorkflowState(),
        activePlan: 'PLAN.md',
        currentTask: 'Second',
        currentTaskIndex: 2,
        taskCount: 2,
      },
    ),
    true,
  );
});

test('auto lifecycle syncs lifecycle phases from plan evidence', () => {
  const state = stateWithCompletedLifecyclePhasesFromPlan(
    createInitialWorkflowState(),
    {
      prompt: '/addy-review PLAN.md',
      missingStatuses: ['Reviewed'],
    },
  );

  assert.equal(state.phases.build, 'complete');
  assert.equal(state.phases.verify, 'complete');
  assert.equal(state.phases.review, 'pending');
});

test('auto lifecycle moves closed reviewed plan to finish when no next slice exists', () => {
  const { dir, plan } = writePlan(`# Plan

## Task 1. Complete slice
<!-- addy-task-id: closed-task -->
- [x] Implemented
- [x] Verified
- [x] Reviewed
`);
  try {
    const result = completedPlanAutoContinuation(
      {
        ...createInitialWorkflowState(),
        activePlan: plan,
        committedTasks: {
          [workflowTaskCommitKey(plan, 1, 'Complete slice', 'closed-task')]: {
            plan,
            taskId: 'closed-task',
            taskIndex: 1,
            taskTitle: 'Complete slice',
            commitSha: 'abc123',
            committedAt: '2026-01-01T00:00:00.000Z',
          },
        },
      },
      {
        prompt: `/addy-review ${plan}`,
        taskId: 'closed-task',
        taskTitle: 'Complete slice',
      },
    );

    assert.equal(result?.state.activePlan, plan);
    assert.equal(result?.action?.prompt, `/addy-finish ${plan}`);
    assert.deepEqual(result?.action?.missingStatuses, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('auto lifecycle advances closed slice to next unfinished slice', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-addy-auto-lifecycle-slices-'));
  const firstSlice = join(dir, 'slice-01.md');
  const nextSlice = join(dir, 'slice-02.md');
  writeFileSync(
    firstSlice,
    `# Slice 1

## Task 1. Closed
<!-- addy-task-id: first-task -->
- [x] Implemented
- [x] Verified
- [x] Reviewed
`,
  );
  writeFileSync(
    nextSlice,
    `# Slice 2

## Task 1. Next
<!-- addy-task-id: next-task -->
- [ ] Implemented
- [ ] Verified
- [ ] Reviewed
`,
  );
  try {
    const result = completedPlanAutoContinuation(
      {
        ...createInitialWorkflowState(),
        activePlan: firstSlice,
        currentTask: 'Closed',
        currentTaskId: 'first-task',
        currentTaskIndex: 1,
        taskCount: 1,
        autoReviewTask: 'Closed',
        autoReviewTaskId: 'first-task',
        autoReviewTaskIndex: 1,
        committedTasks: {
          [workflowTaskCommitKey(firstSlice, 1, 'Closed', 'first-task')]: {
            plan: firstSlice,
            taskId: 'first-task',
            taskIndex: 1,
            taskTitle: 'Closed',
            commitSha: 'abc123',
            committedAt: '2026-01-01T00:00:00.000Z',
          },
        },
      },
      {
        prompt: `/addy-finish ${firstSlice}`,
        taskId: 'first-task',
        taskTitle: 'Closed',
      },
    );

    assert.equal(result?.state.activePlan, nextSlice);
    assert.equal(result?.state.activeSuitePlan, firstSlice);
    assert.equal(result?.state.currentTask, undefined);
    assert.equal(result?.state.autoReviewTask, undefined);
    assert.equal(result?.action?.prompt, `/addy-build ${nextSlice}`);
    assert.equal(result?.action?.taskTitle, 'Next');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Ticket Auto frontier never dispatches optional SIMPLIFY', () => {
  const state = {
    ...createInitialWorkflowState(),
    executionSource: 'ticket' as const,
    ticketRun: {
      schemaVersion: 1 as const,
      source: { kind: 'github' as const, ref: '#10' },
      runId: 'run-1',
      claim: {
        id: 'claim-1',
        owner: 'agent',
        claimedAt: '2026-07-15T00:00:00.000Z',
      },
      lifecycle: {
        implemented: true,
        verified: false,
        reviewed: false,
        lastCompletedPhase: 'build' as const,
      },
      repositoryScope: ['/repo'],
    },
  };

  assert.equal(
    nextWorkflowActionForExecutionSource(state)?.prompt,
    '/addy-verify --ticket #10',
  );
});

test('auto lifecycle renders same-phase retry guidance', () => {
  const warning = autoPauseWarning('/addy-review PLAN.md', {
    prompt: '/addy-review PLAN.md',
    taskTitle: 'Extract module',
    missingStatuses: ['Reviewed'],
  });
  assert.match(warning, /Extract module/);
  assert.match(warning, /Missing: Reviewed/);

  const prompt = autoRecoveryPrompt(
    '/addy-review PLAN.md',
    {
      prompt: '/addy-review PLAN.md',
      taskTitle: 'Extract module',
      missingStatuses: ['Reviewed'],
    },
    1,
  );
  assert.match(prompt, /Addy Auto Same-Phase Recovery Pass/);
  assert.match(prompt, /autonomous retry #2/);
  assert.match(prompt, /Target task: Extract module/);
  assert.match(prompt, /Missing lifecycle evidence: Reviewed/);
});

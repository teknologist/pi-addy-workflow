import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isValidProgress,
  nextUnfinishedSlicePlanPath,
  sliceProgressForPlanPath,
  totalTaskProgressForSlice,
} from '../extensions/workflow-monitor/slice-plan-series.ts';
import { workflowTaskCommitKey } from '../extensions/workflow-monitor/plan-task-lifecycle.ts';
import { createInitialWorkflowState } from '../extensions/workflow-monitor/workflow-transitions.ts';

function committedTask(
  plan: string,
  taskIndex: number,
  taskTitle: string,
  sliceIndex?: number,
) {
  return {
    [workflowTaskCommitKey(plan, taskIndex, taskTitle)]: {
      plan,
      taskIndex,
      taskTitle,
      sliceIndex,
      commitSha: 'abc1234',
      committedAt: '2026-05-21T00:00:00.000Z',
    },
  };
}

test('slice plan series resolves index plans to the first unfinished slice', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'slice-plan-series-index-'));
  const plansDir = join(cwd, 'docs', 'plans');
  mkdirSync(plansDir, { recursive: true });
  writeFileSync(
    join(plansDir, 'migration-index.md'),
    [
      '# Migration index',
      '',
      '1. [Slice 1](./migration-slice-01-api.md)',
      '2. [Slice 2](./migration-slice-02-runtime.md)',
    ].join('\n'),
  );
  writeFileSync(
    join(plansDir, 'migration-slice-01-api.md'),
    [
      '## Task 1: Complete API',
      '- [x] Implemented',
      '- [x] Verified',
      '- [x] Reviewed',
    ].join('\n'),
  );
  writeFileSync(
    join(plansDir, 'migration-slice-02-runtime.md'),
    [
      '## Task 1: Migrate runtime',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );

  assert.equal(
    nextUnfinishedSlicePlanPath(
      {
        ...createInitialWorkflowState(),
        activePlan: '@docs/plans/migration-index.md',
        committedTasks: committedTask(
          '@docs/plans/migration-slice-01-api.md',
          1,
          'Complete API',
          1,
        ),
      },
      cwd,
    ),
    '@docs/plans/migration-slice-02-runtime.md',
  );
});

test('slice plan series scans numeric siblings for next slice and total task progress', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'slice-plan-series-numbered-'));
  const plansDir = join(cwd, 'docs', 'plans');
  mkdirSync(plansDir, { recursive: true });
  for (const slice of [1, 2, 3]) {
    writeFileSync(
      join(plansDir, `feature-slice-${String(slice).padStart(2, '0')}.md`),
      [
        `## Task 1: Slice ${slice} task 1`,
        '- [x] Implemented',
        '- [x] Verified',
        '- [x] Reviewed',
        '',
        `## Task 2: Slice ${slice} task 2`,
        slice === 1 ? '- [x] Implemented' : '- [ ] Implemented',
        slice === 1 ? '- [x] Verified' : '- [ ] Verified',
        slice === 1 ? '- [x] Reviewed' : '- [ ] Reviewed',
      ].join('\n'),
    );
  }

  const activePlan = '@docs/plans/feature-slice-01.md';
  assert.equal(
    nextUnfinishedSlicePlanPath(
      {
        ...createInitialWorkflowState(),
        activePlan,
        committedTasks: {
          ...committedTask(activePlan, 1, 'Slice 1 task 1', 1),
          ...committedTask(activePlan, 2, 'Slice 1 task 2', 1),
        },
      },
      cwd,
    ),
    '@docs/plans/feature-slice-02.md',
  );
  assert.deepEqual(
    sliceProgressForPlanPath('@docs/plans/feature-slice-02.md', cwd),
    {
      currentSliceIndex: 2,
      sliceCount: 3,
    },
  );
  assert.deepEqual(
    totalTaskProgressForSlice('@docs/plans/feature-slice-02.md', 1, cwd),
    {
      currentTaskIndex: 3,
      taskCount: 6,
    },
  );
});

test('slice plan series validates bounded progress indexes', () => {
  assert.equal(isValidProgress(1, 3), true);
  assert.equal(isValidProgress(0, 3), false);
  assert.equal(isValidProgress(4, 3), false);
  assert.equal(isValidProgress(1.5, 3), false);
});

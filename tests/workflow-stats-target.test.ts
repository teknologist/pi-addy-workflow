import test from 'node:test';
import assert from 'node:assert/strict';
import {
  latestActiveStatsTarget,
  statsTargetFromTask,
} from '../extensions/workflow-monitor/workflow-stats-target.ts';
import { emptyIssueStats } from '../extensions/workflow-monitor/workflow-stats.ts';
import type { WorkflowState } from '../extensions/workflow-monitor/workflow-transitions.ts';

test('stats target from task preserves task identity fields', () => {
  assert.deepEqual(
    statsTargetFromTask({
      plan: 'plans/slice-01.md',
      taskId: 'task-a',
      sliceIndex: 1,
      taskIndex: 2,
      taskTitle: 'Implement target',
      turns: 1,
      verifyRuns: 0,
      reviewRuns: 0,
      issues: emptyIssueStats(),
    }),
    {
      plan: 'plans/slice-01.md',
      taskId: 'task-a',
      sliceIndex: 1,
      taskIndex: 2,
      taskTitle: 'Implement target',
    },
  );
});

test('latest active stats target returns most recent active task target', () => {
  const state: WorkflowState = {
    phases: {
      define: 'complete',
      plan: 'complete',
      build: 'active',
      simplify: 'pending',
      verify: 'pending',
      review: 'pending',
      finish: 'pending',
    },
    warnings: [],
    stats: {
      active: {
        tasks: {
          first: {
            taskTitle: 'First',
            taskIndex: 1,
            turns: 1,
            verifyRuns: 0,
            reviewRuns: 0,
            issues: emptyIssueStats(),
          },
          second: {
            taskTitle: 'Second',
            taskIndex: 2,
            taskId: 'task-b',
            turns: 1,
            verifyRuns: 0,
            reviewRuns: 0,
            issues: emptyIssueStats(),
          },
        },
      },
      history: [],
    },
  };

  assert.deepEqual(latestActiveStatsTarget(state), {
    plan: undefined,
    taskTitle: 'Second',
    taskIndex: 2,
    taskId: 'task-b',
    sliceIndex: undefined,
  });
});

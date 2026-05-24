import test from 'node:test';
import assert from 'node:assert/strict';
import { stateWithAgentEndReviewIssues } from '../extensions/workflow-monitor/agent-end-review-stats.ts';
import { createInitialWorkflowState } from '../extensions/workflow-monitor/workflow-transitions.ts';

test('agent-end review stats records matching review agent findings', () => {
  const state = stateWithAgentEndReviewIssues(
    {
      ...createInitialWorkflowState(),
      reviewStatsKey: 'review-task',
      reviewStatsAgent: 'addy-reviewer',
      stats: {
        active: {
          tasks: {
            'review-task': {
              taskTitle: 'Review task',
              turns: 1,
              verifyRuns: 0,
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
    { agentName: 'addy-reviewer' },
    ['Warnings:', '- tests/workflow-monitor.test.ts:42 missing assertion'].join(
      '\n',
    ),
  );

  assert.equal(state.stats?.active.tasks['review-task']?.issues.total, 1);
  assert.equal(state.stats?.active.tasks['review-task']?.issues.important, 1);
});

test('agent-end review stats ignores non-matching review agent', () => {
  const initial = {
    ...createInitialWorkflowState(),
    reviewStatsKey: 'review-task',
    reviewStatsAgent: 'addy-reviewer',
  };

  assert.equal(
    stateWithAgentEndReviewIssues(
      initial,
      { agentName: 'other-agent' },
      [
        'Warnings:',
        '- tests/workflow-monitor.test.ts:42 missing assertion',
      ].join('\n'),
    ),
    initial,
  );
});

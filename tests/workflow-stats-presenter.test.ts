import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADDY_STATS_MESSAGE_TYPE,
  latestActiveStatsTarget,
  showWorkflowStats,
  statsMarkdownWithHeading,
} from '../extensions/workflow-monitor/workflow-stats-presenter.ts';
import { createInitialWorkflowState } from '../extensions/workflow-monitor/workflow-transitions.ts';

function stateWithStats() {
  return {
    ...createInitialWorkflowState(),
    activePlan: 'PLAN.md',
    stats: {
      active: {
        tasks: {
          first: {
            plan: 'PLAN.md',
            taskId: 'task-1',
            taskIndex: 1,
            taskTitle: 'Extract stats presenter',
            turns: 2,
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
  };
}

test('workflow stats presenter returns latest active stats target', () => {
  const target = latestActiveStatsTarget(stateWithStats());

  assert.equal(target?.plan, 'PLAN.md');
  assert.equal(target?.taskId, 'task-1');
  assert.equal(target?.taskTitle, 'Extract stats presenter');
});

test('workflow stats presenter adds heading without losing markdown hierarchy', () => {
  const markdown = statsMarkdownWithHeading(stateWithStats(), {
    heading: 'Addy auto stopped.',
  });

  assert.match(markdown, /^## Addy auto stopped\./);
  assert.match(markdown, /### Addy stats/);
});

test('workflow stats presenter sends custom markdown messages when available', () => {
  const messages: unknown[] = [];
  const pi = {
    sendMessage: (message: unknown) => messages.push(message),
  };
  const notifications: unknown[] = [];

  showWorkflowStats(
    pi as never,
    {},
    stateWithStats(),
    { heading: 'Stats' },
    (_ctx, message, level) => notifications.push({ message, level }),
  );

  assert.equal(notifications.length, 0);
  assert.equal(messages.length, 1);
  const message = messages[0] as {
    customType?: string;
    content?: string;
    display?: boolean;
    details?: { markdown?: string };
  };
  assert.equal(message.customType, ADDY_STATS_MESSAGE_TYPE);
  assert.equal(message.display, true);
  assert.match(message.content ?? '', /^Stats\n/);
  assert.match(message.details?.markdown ?? '', /^## Stats/);
});

test('workflow stats presenter falls back to notification without custom messages', () => {
  const notifications: Array<{ message: string; level?: string }> = [];

  showWorkflowStats(
    {} as never,
    {},
    stateWithStats(),
    {},
    (_ctx, message, level) => notifications.push({ message, level }),
  );

  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].level, 'info');
  assert.match(notifications[0].message, /Addy stats/);
});

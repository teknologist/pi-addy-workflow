import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildTaskFinishedPushoverMessage,
  maybeSendTaskFinishedPushoverNotification,
} from '../extensions/workflow-monitor/pushover-notifications.ts';
import { createInitialWorkflowState } from '../extensions/workflow-monitor/workflow-transitions.ts';
import type { AddyWorkflowConfig } from '../extensions/workflow-monitor/config.ts';

function config(enabled = true): AddyWorkflowConfig {
  return {
    auto: {
      freshContext: {
        beforeEveryStep: true,
        betweenTasks: true,
        beforeReview: false,
      },
      review: { maxFixLoops: 3 },
      notifications: {
        pushover: {
          enabled,
          appToken: 'app-token',
          userKey: 'user-key',
          priority: 0,
        },
      },
    },
  };
}

function createPlanProject(): { cwd: string; planPath: string } {
  const cwd = mkdtempSync(join(tmpdir(), 'addy-pushover-test-'));
  const planPath = join('docs', 'plans', 'slice-01-demo.md');
  mkdirSync(join(cwd, 'docs', 'plans'), { recursive: true });
  writeFileSync(
    join(cwd, planPath),
    [
      '## Task 1: First task',
      '<!-- addy-task-id: task-one -->',
      '- [x] Implemented',
      '- [x] Verified',
      '- [x] Reviewed',
      '',
      '## Task 2: Second task',
      '<!-- addy-task-id: task-two -->',
      '- [ ] Implemented',
      '- [ ] Verified',
      '- [ ] Reviewed',
    ].join('\n'),
  );
  return { cwd, planPath };
}

test('buildTaskFinishedPushoverMessage includes progress duration and retries', () => {
  const { cwd, planPath } = createPlanProject();
  const state = {
    ...createInitialWorkflowState(),
    current: 'review' as const,
    activePlan: planPath,
    currentTask: 'First task',
    currentTaskId: 'task-one',
    currentTaskIndex: 1,
    taskCount: 2,
    currentSliceIndex: 1,
    sliceCount: 1,
    stats: {
      active: {
        tasks: {
          task: {
            plan: planPath,
            taskId: 'task-one',
            taskIndex: 1,
            taskTitle: 'First task',
            startedAt: '2026-05-27T10:00:00.000Z',
            finishedAt: '2026-05-27T10:05:30.000Z',
            phaseDurationsMs: {
              build: 120_000,
              verify: 90_000,
              review: 120_000,
            },
            turns: 5,
            verifyRuns: 3,
            reviewRuns: 2,
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

  const message = buildTaskFinishedPushoverMessage(
    state,
    { plan: planPath, taskId: 'task-one' },
    cwd,
  );

  assert.match(message?.message ?? '', /Addy task finished: First task/);
  assert.match(message?.message ?? '', /Task 1\/2 finished, 1 left/);
  assert.match(
    message?.message ?? '',
    /Slice 1\/1 · Task 1\/2 · Total 1\/2 \(50%\)/,
  );
  assert.match(message?.message ?? '', /Cycle time: 5m 30s/);
  assert.match(
    message?.message ?? '',
    /Step time: build 2m 0s, verify 1m 30s, review 2m 0s/,
  );
  assert.match(message?.message ?? '', /Verify retries: 2/);
  assert.match(message?.message ?? '', /Review retries: 1/);
  assert.match(message?.message ?? '', /Plan: slice-01-demo\.md/);
});

test('maybeSendTaskFinishedPushoverNotification posts when enabled', async () => {
  const { cwd, planPath } = createPlanProject();
  const calls: Array<{ url: string; body: URLSearchParams }> = [];
  const fakeFetch = (async (
    url: string | URL | Request,
    init?: RequestInit,
  ) => {
    calls.push({ url: String(url), body: init?.body as URLSearchParams });
    return { ok: true, status: 200 } as Response;
  }) as typeof fetch;

  await maybeSendTaskFinishedPushoverNotification({
    config: config(true),
    cwd,
    fetch: fakeFetch,
    state: {
      ...createInitialWorkflowState(),
      current: 'review',
      activePlan: planPath,
      stats: {
        active: {
          tasks: {
            task: {
              plan: planPath,
              taskTitle: 'First task',
              startedAt: '2026-05-27T10:00:00.000Z',
              finishedAt: '2026-05-27T10:01:00.000Z',
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
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, 'https://api.pushover.net/1/messages.json');
  assert.equal(calls[0]?.body.get('token'), 'app-token');
  assert.equal(calls[0]?.body.get('user'), 'user-key');
  assert.match(calls[0]?.body.get('message') ?? '', /First task/);
});

test('maybeSendTaskFinishedPushoverNotification is disabled by config', async () => {
  const calls: string[] = [];
  const fakeFetch = (async () => {
    calls.push('fetch');
    return { ok: true, status: 200 } as Response;
  }) as typeof fetch;

  await maybeSendTaskFinishedPushoverNotification({
    config: config(false),
    fetch: fakeFetch,
    state: createInitialWorkflowState(),
  });

  assert.deepEqual(calls, []);
});
